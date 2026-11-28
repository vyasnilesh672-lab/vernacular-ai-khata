
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import connectDB from "./config/db.js";
import customerRoutes from "./routes/customerRoutes.js";
import customerIntelligenceRoutes from "./routes/customerIntelligenceRoutes.js";
import commitmentRoutes from "./routes/commitmentRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import reminderRoutes from "./routes/reminderRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import commandRoutes from "./routes/commandRoutes.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.get("/", (req, res) => {
  res.send("Vernacular AI Khata API is running!");
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Backend is healthy",
  });
});

app.use("/api/customers", customerRoutes);
app.use("/api/customers", customerIntelligenceRoutes);
app.use("/api/commitments", commitmentRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/reminders", reminderRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/commands", commandRoutes);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
};

startServer();
