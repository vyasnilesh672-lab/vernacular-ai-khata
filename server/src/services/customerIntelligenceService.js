import mongoose from "mongoose";
import Customer from "../models/Customer.js";
import Commitment from "../models/Commitment.js";
import StockMovement from "../models/StockMovement.js";
import CustomerReply from "../models/CustomerReply.js";
import Reminder from "../models/Reminder.js";

export class CustomerIntelligenceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const getTodayIST = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

const parseDateRange = ({ startDate, endDate } = {}) => {
  const filter = {};
  if (startDate !== undefined && startDate !== "") {
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      throw new CustomerIntelligenceError(400, "Invalid startDate");
    }
    filter.$gte = start;
  }
  if (endDate !== undefined && endDate !== "") {
    const end = new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(String(endDate))
        ? `${endDate}T23:59:59.999Z`
        : endDate
    );
    if (Number.isNaN(end.getTime())) {
      throw new CustomerIntelligenceError(400, "Invalid endDate");
    }
    filter.$lte = end;
  }
  if (filter.$gte && filter.$lte && filter.$gte > filter.$lte) {
    throw new CustomerIntelligenceError(
      400,
      "startDate cannot be after endDate"
    );
  }
  return Object.keys(filter).length > 0 ? filter : null;
};

const parsePagination = ({ page = 1, limit = 10 } = {}) => {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);
  const safePage =
    Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const safeLimit =
    Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 100
      ? parsedLimit
      : 10;
  return { page: safePage, limit: safeLimit };
};

const roundMoney = (n) => Number(Number(n || 0).toFixed(2));
const roundMetric = (n) => Number(Number(n || 0).toFixed(2));

const toUTCDateISO = (dateValue) =>
  new Date(dateValue).toISOString().slice(0, 10);

const diffDaysUTC = (laterISO, earlierISO) => {
  const later = new Date(`${laterISO}T00:00:00.000Z`).getTime();
  const earlier = new Date(`${earlierISO}T00:00:00.000Z`).getTime();
  return Math.round((later - earlier) / 86400000);
};

const hasRenegotiationHistory = (commitment) =>
  Array.isArray(commitment.history) &&
  commitment.history.some(
    (h) =>
      h.action === "extension_confirmed" ||
      h.action === "promised_date_updated" ||
      h.action === "partial_payment_recorded"
  );

/**
 * Compute deterministic financial profile, pattern trend, explainable risk score,
 * and factual vendor insights from actual MongoDB records for a customer.
 */
export const buildCustomerIntelligence = async (
  customerId,
  { startDate, endDate } = {}
) => {
  if (!customerId || !mongoose.isValidObjectId(customerId)) {
    throw new CustomerIntelligenceError(400, "Valid customer ID is required");
  }

  const customer = await Customer.findById(customerId).lean();
  if (!customer) {
    throw new CustomerIntelligenceError(404, "Customer not found");
  }

  const dateFilter = parseDateRange({ startDate, endDate });

  const commitmentQuery = {
    customer: customer._id,
    confirmedByVendor: true,
  };
  if (dateFilter) {
    commitmentQuery.createdAt = dateFilter;
  }

  const saleQuery = {
    customer: customer._id,
    movementType: "sale",
  };
  if (dateFilter) {
    saleQuery.createdAt = dateFilter;
  }

  const replyQuery = { customer: customer._id };
  const reminderQuery = { customer: customer._id };
  if (dateFilter) {
    replyQuery.createdAt = dateFilter;
    reminderQuery.createdAt = dateFilter;
  }

  const [commitments, sales, repliesCount, remindersCount] = await Promise.all([
    Commitment.find(commitmentQuery).sort({ createdAt: 1 }).lean(),
    StockMovement.find(saleQuery)
      .populate("product", "name unit")
      .sort({ createdAt: -1 })
      .lean(),
    CustomerReply.countDocuments(replyQuery),
    Reminder.countDocuments(reminderQuery),
  ]);

  const todayISO = getTodayIST();
  const currentMonthPrefix = todayISO.slice(0, 7);

  // Sum child partial payments by parentCommitment so paid amounts are never double-counted
  const childPaidByParent = new Map();
  for (const c of commitments) {
    if (c.parentCommitment && c.paymentStatus === "Paid") {
      const parentId = c.parentCommitment.toString();
      const paidVal = c.paidAmount > 0 ? c.paidAmount : c.amount;
      childPaidByParent.set(
        parentId,
        (childPaidByParent.get(parentId) || 0) + paidVal
      );
    }
  }

  let totalAmountPaid = 0;
  let outstandingBalance = 0;
  let overdueOutstandingAmount = 0;
  let monthOutstandingDelta = 0;

  let completedCommitmentsCount = 0;
  let overdueCommitmentsCount = 0;
  let brokenPromisesCount = 0;
  let renegotiatedCommitmentsCount = 0;
  let partialPaymentsCount = 0;
  let directPaymentsReceivedCount = 0;
  let upcomingPendingCount = 0;

  const paymentDelays = [];
  let maxOverdueDays = 0;
  const maturedChronological = [];
  const influencingRecords = [];
  const activityEntries = [];

  for (const c of commitments) {
    const promisedISO = toUTCDateISO(c.promisedDate);
    const isChildPartial = Boolean(c.parentCommitment);
    const isDirectReceipt = c.transactionType === "payment_received";
    const isPaid = c.paymentStatus === "Paid";

    if (isChildPartial) {
      partialPaymentsCount += 1;
    } else if (
      Array.isArray(c.history) &&
      c.history.some((h) => h.action === "partial_payment_recorded")
    ) {
      // Count parent partial events only if no child doc was included in filtered window
      const hasChildInSet = commitments.some(
        (other) =>
          other.parentCommitment &&
          other.parentCommitment.toString() === c._id.toString()
      );
      if (!hasChildInSet) {
        partialPaymentsCount += 1;
      }
    }

    if (isDirectReceipt && !isChildPartial) {
      directPaymentsReceivedCount += 1;
    }

    if (isChildPartial) {
      if (isPaid) {
        const val = c.paidAmount > 0 ? c.paidAmount : c.amount;
        totalAmountPaid += val;
      }
    } else {
      const childSum = childPaidByParent.get(c._id.toString()) || 0;
      if (isPaid) {
        const grossPaid =
          c.paidAmount > 0 ? c.paidAmount : c.originalAmount || c.amount;
        totalAmountPaid += Math.max(0, grossPaid - childSum);
      } else {
        const directParentPaid = Math.max(0, (c.paidAmount || 0) - childSum);
        totalAmountPaid += directParentPaid;
        outstandingBalance += c.amount;

        const createdISO = toUTCDateISO(c.createdAt || c.promisedDate);
        if (createdISO.startsWith(currentMonthPrefix)) {
          monthOutstandingDelta += c.amount;
        }
      }
    }

    // Track actual payment vs promise activity distinctly
    if (isPaid) {
      const paidVal = c.paidAmount > 0 ? c.paidAmount : c.originalAmount || c.amount;
      activityEntries.push({
        entryId: c._id,
        entryKind: "actual_payment",
        sourceType: isChildPartial
          ? "partial_payment"
          : isDirectReceipt
            ? "direct_payment"
            : "settled_commitment",
        amount: roundMoney(paidVal),
        date: c.paidAt || c.updatedAt || c.createdAt,
        promisedDate: c.promisedDate,
        status: c.status,
        paymentStatus: c.paymentStatus,
        note: c.originalMessage,
      });
    } else {
      activityEntries.push({
        entryId: c._id,
        entryKind: "payment_promise",
        sourceType: c.transactionType,
        amount: roundMoney(c.amount),
        originalAmount: c.originalAmount || c.amount,
        date: c.createdAt,
        promisedDate: c.promisedDate,
        status: c.status,
        paymentStatus: c.paymentStatus,
        isOverdue: promisedISO < todayISO,
        note: c.originalMessage,
      });
    }

    // Only obligation records (not direct cash-in receipts) evaluate promise reliability
    if (!isDirectReceipt && !isChildPartial) {
      const isRenegotiated =
        c.status === "Renegotiated" || hasRenegotiationHistory(c);
      if (isRenegotiated) {
        renegotiatedCommitmentsCount += 1;
      }

      if (isPaid || c.status === "Kept") {
        completedCommitmentsCount += 1;

        let delayDays = null;
        if (c.paidAt && c.promisedDate) {
          const paidISO = toUTCDateISO(c.paidAt);
          delayDays = Math.max(0, diffDaysUTC(paidISO, promisedISO));
          paymentDelays.push(delayDays);
        }

        const reliabilityScore =
          delayDays !== null && delayDays > 2
            ? 0.6
            : isRenegotiated
              ? 0.7
              : 1;

        maturedChronological.push({
          commitmentId: c._id,
          outcome: "completed",
          reliabilityScore,
          delayDays,
          date: c.promisedDate,
        });

        influencingRecords.push({
          commitmentId: c._id,
          role: "completed",
          amount: c.originalAmount || c.amount,
          promisedDate: c.promisedDate,
          paidAt: c.paidAt,
          delayDays,
          status: c.status,
        });
      } else if (c.status === "Broken") {
        brokenPromisesCount += 1;
        const overdueDays =
          promisedISO < todayISO ? diffDaysUTC(todayISO, promisedISO) : 0;
        if (overdueDays > 0) {
          overdueCommitmentsCount += 1;
          overdueOutstandingAmount += c.amount;
          maxOverdueDays = Math.max(maxOverdueDays, overdueDays);
        }

        maturedChronological.push({
          commitmentId: c._id,
          outcome: "broken",
          reliabilityScore: 0,
          delayDays: overdueDays,
          date: c.promisedDate,
        });

        influencingRecords.push({
          commitmentId: c._id,
          role: "broken",
          amount: c.amount,
          promisedDate: c.promisedDate,
          overdueDays,
          status: c.status,
        });
      } else if (promisedISO < todayISO) {
        overdueCommitmentsCount += 1;
        overdueOutstandingAmount += c.amount;
        const overdueDays = diffDaysUTC(todayISO, promisedISO);
        maxOverdueDays = Math.max(maxOverdueDays, overdueDays);

        maturedChronological.push({
          commitmentId: c._id,
          outcome: "overdue",
          reliabilityScore: 0.15,
          delayDays: overdueDays,
          date: c.promisedDate,
        });

        influencingRecords.push({
          commitmentId: c._id,
          role: isRenegotiated ? "overdue_renegotiated" : "overdue",
          amount: c.amount,
          promisedDate: c.promisedDate,
          overdueDays,
          status: c.status,
        });
      } else {
        upcomingPendingCount += 1;
        if (isRenegotiated) {
          influencingRecords.push({
            commitmentId: c._id,
            role: "renegotiated",
            amount: c.amount,
            promisedDate: c.promisedDate,
            status: c.status,
          });
        }
      }
    }
  }

  let totalPurchasesAmount = 0;
  for (const s of sales) {
    totalPurchasesAmount += s.totalRevenue || 0;
    activityEntries.push({
      entryId: s._id,
      entryKind: "inventory_purchase",
      sourceType: "sale",
      productName: s.product?.name || "Product",
      quantity: s.quantity,
      unit: s.unit,
      amount: roundMoney(s.totalRevenue || 0),
      unitPrice: s.unitPrice,
      date: s.createdAt,
      note: s.note || s.reason,
    });
  }

  activityEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

  const lastTransactionDate =
    activityEntries.length > 0 ? activityEntries[0].date : null;

  const averagePaymentDelayAvailable = paymentDelays.length >= 2;
  const averagePaymentDelayDays = averagePaymentDelayAvailable
    ? roundMetric(
        paymentDelays.reduce((sum, d) => sum + d, 0) / paymentDelays.length
      )
    : null;

  const totalPromisesCount =
    completedCommitmentsCount +
    overdueCommitmentsCount +
    brokenPromisesCount +
    upcomingPendingCount;

  // Deterministic pattern trend (improving / worsening / stable / insufficient_history)
  let patternTrend = "insufficient_history";
  let patternExplanation =
    "At least 3 completed, overdue, or broken commitments are required to detect a payment pattern.";

  if (maturedChronological.length >= 3) {
    const splitIdx = Math.floor(maturedChronological.length / 2);
    const earlier = maturedChronological.slice(0, splitIdx);
    const recent = maturedChronological.slice(splitIdx);
    const avg = (arr) =>
      arr.reduce((sum, item) => sum + item.reliabilityScore, 0) / arr.length;
    const earlierAvg = avg(earlier);
    const recentAvg = avg(recent);
    const delta = recentAvg - earlierAvg;

    if (delta >= 0.15) {
      patternTrend = "improving";
      patternExplanation =
        "Recent commitment fulfillment is stronger than earlier payment history.";
    } else if (delta <= -0.15) {
      patternTrend = "worsening";
      patternExplanation =
        "Recent commitments show more delays, overdues, or broken promises than earlier history.";
    } else {
      patternTrend = "stable";
      patternExplanation =
        "Customer payment behavior has remained consistent across recorded commitments.";
    }
  }

  // Explainable Udhaar Risk Assessment (0-100 estimate)
  const riskAssessment = computeExplainableRisk({
    totalPromisesCount,
    maturedCount: maturedChronological.length,
    completedCommitmentsCount,
    overdueCommitmentsCount,
    overdueOutstandingAmount: roundMoney(overdueOutstandingAmount),
    outstandingBalance: roundMoney(outstandingBalance),
    totalAmountPaid: roundMoney(totalAmountPaid),
    brokenPromisesCount,
    renegotiatedCommitmentsCount,
    partialPaymentsCount,
    averagePaymentDelayAvailable,
    averagePaymentDelayDays,
    maxOverdueDays,
    settledDelaySampleCount: paymentDelays.length,
    influencingRecords,
  });

  // Actionable factual vendor insights
  const insights = generateFactualInsights({
    overdueCommitmentsCount,
    overdueOutstandingAmount: roundMoney(overdueOutstandingAmount),
    monthOutstandingDelta: roundMoney(monthOutstandingDelta),
    maturedChronological,
    brokenPromisesCount,
    renegotiatedCommitmentsCount,
    riskAssessment,
    patternTrend,
  });

  return {
    customer: {
      _id: customer._id,
      name: customer.name,
      phone: customer.phone,
      preferredLanguage: customer.preferredLanguage,
      createdAt: customer.createdAt,
    },
    dateRange: dateFilter
      ? { startDate: startDate || null, endDate: endDate || null }
      : null,
    financialProfile: {
      totalPurchases: roundMoney(totalPurchasesAmount),
      totalPurchaseTransactions: sales.length,
      totalAmountPaid: roundMoney(totalAmountPaid),
      outstandingBalance: roundMoney(outstandingBalance),
      overdueOutstandingAmount: roundMoney(overdueOutstandingAmount),
      completedCommitmentsCount,
      overdueCommitmentsCount,
      brokenPromisesCount,
      renegotiatedCommitmentsCount,
      partialPaymentsCount,
      directPaymentsReceivedCount,
      upcomingPendingCount,
      totalPromisesCount,
      averagePaymentDelayDays,
      averagePaymentDelayAvailable,
      averagePaymentDelayNote: averagePaymentDelayAvailable
        ? `Computed from ${paymentDelays.length} settled commitments`
        : "Insufficient settled payment history (requires at least 2 paid commitments with timestamps)",
      lastTransactionDate,
      remindersSentCount: remindersCount,
      repliesReceivedCount: repliesCount,
      recentPaymentActivity: activityEntries.slice(0, 10),
    },
    pattern: {
      trend: patternTrend,
      maturedCommitmentsEvaluated: maturedChronological.length,
      explanation: patternExplanation,
    },
    riskAssessment,
    insights,
    allActivityEntries: activityEntries,
  };
};

const computeExplainableRisk = ({
  totalPromisesCount,
  maturedCount,
  completedCommitmentsCount,
  overdueCommitmentsCount,
  overdueOutstandingAmount,
  outstandingBalance,
  totalAmountPaid,
  brokenPromisesCount,
  renegotiatedCommitmentsCount,
  partialPaymentsCount,
  averagePaymentDelayAvailable,
  averagePaymentDelayDays,
  maxOverdueDays,
  settledDelaySampleCount,
  influencingRecords,
}) => {
  const disclaimer =
    "This risk score is an estimate derived strictly from recorded transaction and commitment history, not a guarantee.";

  // New or unmatured customer: insufficient history
  if (maturedCount === 0 && brokenPromisesCount === 0 && overdueCommitmentsCount === 0) {
    return {
      isEstimate: true,
      disclaimer,
      dataSufficiency: "insufficient_history",
      riskScore: null,
      riskLevel: "Insufficient history",
      scoreBreakdown: [],
      reasons: [
        totalPromisesCount === 0
          ? "No commitments or payment records exist for this customer yet."
          : "Customer only has upcoming commitment(s) with no completed or overdue history yet.",
      ],
      influencingRecords,
    };
  }

  // Single late/overdue commitment without broken promises: never treat 1 late payment as unreliable
  const singleLateOnly =
    maturedCount === 1 &&
    brokenPromisesCount === 0 &&
    overdueCommitmentsCount === 1 &&
    completedCommitmentsCount === 0;

  const totalExposure = Math.max(totalAmountPaid + outstandingBalance, 1);
  const overdueRatio = overdueOutstandingAmount / totalExposure;

  // 1. Overdue outstanding component (0-30)
  let overduePoints = 0;
  if (overdueCommitmentsCount === 1 && brokenPromisesCount === 0) {
    overduePoints = Math.min(12, Math.round(overdueRatio * 12 + 4));
  } else if (overdueCommitmentsCount > 0) {
    overduePoints = Math.min(
      30,
      Math.round(overdueCommitmentsCount * 7 + overdueRatio * 16)
    );
  }

  // 2. Broken promises frequency (0-25)
  const brokenRate =
    maturedCount > 0 ? brokenPromisesCount / maturedCount : 0;
  const brokenPoints =
    brokenPromisesCount > 0
      ? Math.min(25, Math.round(brokenPromisesCount * 8 + brokenRate * 15))
      : 0;

  // 3. Payment delay component (0-20)
  let delayPoints = 0;
  if (averagePaymentDelayAvailable && averagePaymentDelayDays > 0) {
    delayPoints += Math.min(12, Math.round(averagePaymentDelayDays * 1.2));
  }
  if (maxOverdueDays > 0) {
    const overduePenalty = singleLateOnly
      ? Math.min(6, Math.round(maxOverdueDays * 0.4))
      : Math.min(12, Math.round(maxOverdueDays * 0.8));
    delayPoints = Math.min(20, delayPoints + overduePenalty);
  }

  // 4. Renegotiation & unresolved partial friction (0-15)
  const renegotiationRate =
    totalPromisesCount > 0
      ? renegotiatedCommitmentsCount / totalPromisesCount
      : 0;
  let frictionPoints = 0;
  if (renegotiatedCommitmentsCount > 0) {
    frictionPoints += Math.min(10, Math.round(renegotiatedCommitmentsCount * 3 + renegotiationRate * 5));
  }
  if (partialPaymentsCount > 0 && outstandingBalance > 0) {
    frictionPoints += Math.min(5, partialPaymentsCount * 2);
  }
  frictionPoints = Math.min(15, frictionPoints);

  // 5. Reliability offset (-15 to +10)
  const completionRate =
    maturedCount > 0 ? completedCommitmentsCount / maturedCount : 0;
  let consistencyAdjustment = 0;
  if (maturedCount >= 2) {
    if (completionRate >= 0.85 && brokenPromisesCount === 0) {
      consistencyAdjustment = -15;
    } else if (completionRate >= 0.7) {
      consistencyAdjustment = -8;
    } else if (completionRate < 0.5) {
      consistencyAdjustment = 10;
    }
  }

  let rawScore =
    overduePoints +
    brokenPoints +
    delayPoints +
    frictionPoints +
    consistencyAdjustment;

  if (singleLateOnly) {
    rawScore = Math.min(rawScore, 24);
  }

  const riskScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const riskLevel =
    riskScore >= 60 ? "High" : riskScore >= 30 ? "Moderate" : "Low";

  const dataSufficiency =
    maturedCount >= 3 ? "sufficient_history" : "limited_history";

  const reasons = [];
  if (singleLateOnly) {
    reasons.push(
      `1 overdue commitment observed (${maxOverdueDays} day(s) past due); treated cautiously as Low risk because a single late payment does not prove unreliability.`
    );
  } else {
    if (overdueCommitmentsCount > 0) {
      reasons.push(
        `${overdueCommitmentsCount} overdue commitment(s) with ₹${overdueOutstandingAmount.toLocaleString("en-IN")} overdue balance.`
      );
    }
    if (brokenPromisesCount > 0) {
      reasons.push(
        `${brokenPromisesCount} broken promise(s) out of ${maturedCount} matured commitment(s).`
      );
    }
    if (averagePaymentDelayAvailable) {
      reasons.push(
        `Average settled payment delay is ${averagePaymentDelayDays} day(s) across ${settledDelaySampleCount} paid commitments.`
      );
    } else if (maxOverdueDays > 0) {
      reasons.push(`Current unpaid commitment is ${maxOverdueDays} day(s) overdue.`);
    }
    if (renegotiatedCommitmentsCount > 0) {
      reasons.push(
        `${renegotiatedCommitmentsCount} commitment(s) required renegotiation or extension.`
      );
    }
    if (partialPaymentsCount > 0) {
      reasons.push(
        `${partialPaymentsCount} partial payment(s) recorded.`
      );
    }
    if (completedCommitmentsCount > 0 && brokenPromisesCount === 0 && overdueCommitmentsCount === 0) {
      reasons.push(
        `Consistent fulfillment: ${completedCommitmentsCount} of ${maturedCount} matured commitment(s) completed.`
      );
    }
  }

  const scoreBreakdown = [
    {
      factor: "Overdue outstanding burden",
      points: overduePoints,
      maxPoints: 30,
      evidence: `${overdueCommitmentsCount} overdue, ₹${overdueOutstandingAmount} overdue out of ₹${roundMoney(totalExposure)} total volume`,
    },
    {
      factor: "Broken promises frequency",
      points: brokenPoints,
      maxPoints: 25,
      evidence: `${brokenPromisesCount} broken out of ${maturedCount} matured commitments`,
    },
    {
      factor: "Payment delays",
      points: delayPoints,
      maxPoints: 20,
      evidence: averagePaymentDelayAvailable
        ? `Avg settled delay ${averagePaymentDelayDays}d; max active overdue ${maxOverdueDays}d`
        : `Max active overdue ${maxOverdueDays}d (settled delay sample: ${settledDelaySampleCount})`,
    },
    {
      factor: "Renegotiations & partial payment friction",
      points: frictionPoints,
      maxPoints: 15,
      evidence: `${renegotiatedCommitmentsCount} renegotiated, ${partialPaymentsCount} partial payment(s)`,
    },
    {
      factor: "Completion consistency adjustment",
      points: consistencyAdjustment,
      range: "-15 to +10",
      evidence: `${completedCommitmentsCount} completed out of ${maturedCount} matured commitments`,
    },
  ];

  return {
    isEstimate: true,
    disclaimer,
    dataSufficiency,
    riskScore,
    riskLevel,
    scoreBreakdown,
    reasons,
    influencingRecords,
  };
};

const generateFactualInsights = ({
  overdueCommitmentsCount,
  overdueOutstandingAmount,
  monthOutstandingDelta,
  maturedChronological,
  brokenPromisesCount,
  renegotiatedCommitmentsCount,
  riskAssessment,
  patternTrend,
}) => {
  const insights = [];

  if (riskAssessment.riskLevel === "Insufficient history") {
    insights.push(
      "Payment reliability cannot yet be assessed due to limited history."
    );
  }

  if (overdueCommitmentsCount > 0) {
    insights.push(
      `This customer has ${overdueCommitmentsCount} overdue commitment${overdueCommitmentsCount > 1 ? "s" : ""} (₹${overdueOutstandingAmount.toLocaleString("en-IN")}).`
    );
  }

  if (monthOutstandingDelta > 0) {
    insights.push(
      `Outstanding balance increased by ₹${monthOutstandingDelta.toLocaleString("en-IN")} this month.`
    );
  }

  const last10 = maturedChronological.slice(-10);
  if (last10.length >= 2) {
    const completedInLast10 = last10.filter(
      (item) => item.outcome === "completed"
    ).length;
    insights.push(
      `This customer has completed ${completedInLast10} of their last ${last10.length} commitments.`
    );
  }

  if (brokenPromisesCount > 0) {
    insights.push(
      `This customer has ${brokenPromisesCount} broken payment promise${brokenPromisesCount > 1 ? "s" : ""}.`
    );
  }

  if (renegotiatedCommitmentsCount > 0) {
    insights.push(
      `${renegotiatedCommitmentsCount} commitment${renegotiatedCommitmentsCount > 1 ? "s were" : " was"} renegotiated or extended.`
    );
  }

  if (patternTrend === "improving") {
    insights.push("Payment pattern is improving based on recent commitments.");
  } else if (patternTrend === "worsening") {
    insights.push("Payment pattern is worsening compared to earlier commitments.");
  }

  return insights;
};

export const getCustomerPaymentHistory = async (
  customerId,
  { startDate, endDate, entryKind, page = 1, limit = 20 } = {}
) => {
  const intel = await buildCustomerIntelligence(customerId, {
    startDate,
    endDate,
  });

  const allowedKinds = new Set([
    "actual_payment",
    "payment_promise",
    "inventory_purchase",
  ]);
  const filtered =
    entryKind && allowedKinds.has(entryKind)
      ? intel.allActivityEntries.filter((e) => e.entryKind === entryKind)
      : intel.allActivityEntries;

  const { page: safePage, limit: safeLimit } = parsePagination({ page, limit });
  const total = filtered.length;
  const startIndex = (safePage - 1) * safeLimit;
  const items = filtered.slice(startIndex, startIndex + safeLimit);

  return {
    customer: intel.customer,
    totals: {
      totalPurchases: intel.financialProfile.totalPurchases,
      totalAmountPaid: intel.financialProfile.totalAmountPaid,
      outstandingBalance: intel.financialProfile.outstandingBalance,
    },
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
    data: items,
  };
};

export const listCustomersIntelligence = async ({
  filterType = "all",
  trend,
  startDate,
  endDate,
  page = 1,
  limit = 10,
} = {}) => {
  // Validate date/pagination upfront
  parseDateRange({ startDate, endDate });
  const { page: safePage, limit: safeLimit } = parsePagination({ page, limit });

  const customers = await Customer.find().select("_id").lean();
  const profiles = await Promise.all(
    customers.map((c) =>
      buildCustomerIntelligence(c._id.toString(), { startDate, endDate })
    )
  );

  let filtered = profiles.map((p) => ({
    customer: p.customer,
    financialProfile: {
      totalPurchases: p.financialProfile.totalPurchases,
      totalAmountPaid: p.financialProfile.totalAmountPaid,
      outstandingBalance: p.financialProfile.outstandingBalance,
      overdueOutstandingAmount: p.financialProfile.overdueOutstandingAmount,
      completedCommitmentsCount: p.financialProfile.completedCommitmentsCount,
      overdueCommitmentsCount: p.financialProfile.overdueCommitmentsCount,
      brokenPromisesCount: p.financialProfile.brokenPromisesCount,
      renegotiatedCommitmentsCount:
        p.financialProfile.renegotiatedCommitmentsCount,
      averagePaymentDelayDays: p.financialProfile.averagePaymentDelayDays,
      lastTransactionDate: p.financialProfile.lastTransactionDate,
    },
    pattern: p.pattern,
    riskAssessment: {
      isEstimate: p.riskAssessment.isEstimate,
      riskScore: p.riskAssessment.riskScore,
      riskLevel: p.riskAssessment.riskLevel,
      dataSufficiency: p.riskAssessment.dataSufficiency,
      reasons: p.riskAssessment.reasons,
    },
    insights: p.insights,
  }));

  if (filterType === "overdue") {
    filtered = filtered
      .filter((p) => p.financialProfile.overdueCommitmentsCount > 0)
      .sort(
        (a, b) =>
          b.financialProfile.overdueOutstandingAmount -
            a.financialProfile.overdueOutstandingAmount ||
          b.financialProfile.overdueCommitmentsCount -
            a.financialProfile.overdueCommitmentsCount
      );
  } else if (filterType === "highest_outstanding") {
    filtered = filtered
      .filter((p) => p.financialProfile.outstandingBalance > 0)
      .sort(
        (a, b) =>
          b.financialProfile.outstandingBalance -
          a.financialProfile.outstandingBalance
      );
  } else if (filterType === "patterns") {
    if (trend) {
      filtered = filtered.filter((p) => p.pattern.trend === trend);
    } else {
      filtered = filtered.filter(
        (p) =>
          p.pattern.trend === "improving" || p.pattern.trend === "worsening"
      );
    }
    filtered.sort(
      (a, b) =>
        b.financialProfile.outstandingBalance -
        a.financialProfile.outstandingBalance
    );
  }

  const total = filtered.length;
  const startIndex = (safePage - 1) * safeLimit;
  const data = filtered.slice(startIndex, startIndex + safeLimit);

  return {
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    },
    data,
  };
};
