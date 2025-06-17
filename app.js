const express = require("express");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const pickle = require("pickle");

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set up session for flash messages
const session = require("express-session");
app.use(
  session({
    secret: process.env.FLASK_SECRET_KEY || "CHANGE_ME",
    resave: false,
    saveUninitialized: true,
  })
);

// File paths
const BASE_DIR = __dirname;
const DATA_PATH = path.join(BASE_DIR, "data", "student_data_realistic.csv");
const FEATURES_PATH = path.join(BASE_DIR, "models", "feature_list.txt");
const MODEL_PATH = path.join(BASE_DIR, "models", "random_forest_model.pkl");

// Global variables
let studentData = [];
let FEATURES = [];
let model = null;

// Default features
const DEFAULT_FEATURES = [
  "has_prerequisites",
  "credits",
  "attendance_rate",
  "midterm_score",
  "final_score",
  "assignment_score",
  "past_avg_total_score",
  "past_avg_midterm_score",
  "past_avg_final_score",
  "past_avg_assignment_score",
  "past_avg_attendance",
  "past_pass_rate",
  "courses_taken",
  "dept_pass_rate",
  "prereq_avg_score",
  "prereq_pass_rate",
];

// Load historical student data
function loadStudentData() {
  return new Promise((resolve, reject) => {
    const results = [];
    if (!fs.existsSync(DATA_PATH)) {
      console.log("Data file not found, using empty dataset");
      resolve([]);
      return;
    }

    fs.createReadStream(DATA_PATH)
      .pipe(csv())
      .on("data", (data) => results.push(data))
      .on("end", () => {
        console.log(`Loaded ${results.length} historical records`);
        resolve(results);
      })
      .on("error", (error) => {
        console.error("Failed to load historical data:", error);
        resolve([]);
      });
  });
}

// Load features
function loadFeatures() {
  try {
    if (fs.existsSync(FEATURES_PATH)) {
      const data = fs.readFileSync(FEATURES_PATH, "utf8");
      return data
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line);
    }
    return DEFAULT_FEATURES;
  } catch (error) {
    console.error("Error loading features:", error);
    return DEFAULT_FEATURES;
  }
}

// Load model (Note: You'll need a JavaScript ML library or API call)
function loadModel() {
  try {
    // Since pickle is Python-specific, you'll need to either:
    // 1. Convert your model to ONNX format and use onnxjs
    // 2. Use a JavaScript ML library like ml-js
    // 3. Create an API endpoint to call your Python model

    console.log("Using dummy model - implement actual model loading");
    return {
      predict_proba: (features) => {
        // Dummy prediction logic
        const score = Math.random();
        return [[1 - score, score]];
      },
    };
  } catch (error) {
    console.error("Error loading model:", error);
    return null;
  }
}

// Helper: extract student history features
function getHistoryFeatures(studentId, courseCode = null) {
  const records = studentData.filter(
    (record) => parseInt(record.student_id) === parseInt(studentId)
  );

  if (records.length === 0) {
    const defaultFeatures = {};
    FEATURES.forEach((feature) => {
      if (
        feature.startsWith("past_") ||
        [
          "courses_taken",
          "dept_pass_rate",
          "prereq_avg_score",
          "prereq_pass_rate",
        ].includes(feature)
      ) {
        defaultFeatures[feature] = 0;
      }
    });
    return defaultFeatures;
  }

  let pastRecords = records;
  if (courseCode) {
    const filtered = records.filter(
      (record) => record.course_code !== courseCode
    );
    if (filtered.length > 0) {
      pastRecords = filtered;
    }
  }

  // Calculate averages
  const avg = (arr, key) => {
    const values = arr
      .map((record) => parseFloat(record[key]) || 0)
      .filter((v) => !isNaN(v));
    return values.length > 0
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  };

  const features = {
    past_avg_total_score: avg(pastRecords, "total_score"),
    past_avg_midterm_score: avg(pastRecords, "midterm_score"),
    past_avg_final_score: avg(pastRecords, "final_score"),
    past_avg_assignment_score: avg(pastRecords, "assignment_score"),
    past_avg_attendance: avg(pastRecords, "attendance_rate"),
    past_pass_rate: avg(pastRecords, "passed"),
    courses_taken: pastRecords.length,
  };

  // Department pass rate
  if (courseCode) {
    const dept = courseCode.split(" ")[0];
    const deptRecords = pastRecords.filter(
      (record) => record.course_code && record.course_code.startsWith(dept)
    );
    features.dept_pass_rate =
      deptRecords.length > 0
        ? avg(deptRecords, "passed")
        : features.past_pass_rate;
  } else {
    features.dept_pass_rate = features.past_pass_rate;
  }

  // Prerequisite features
  const prereqRecords = pastRecords.filter(
    (record) => parseInt(record.has_prerequisites) === 1
  );
  features.prereq_avg_score =
    prereqRecords.length > 0
      ? avg(prereqRecords, "total_score")
      : features.past_avg_total_score;
  features.prereq_pass_rate =
    prereqRecords.length > 0
      ? avg(prereqRecords, "passed")
      : features.past_pass_rate;

  return features;
}

// HTML template
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Academic Performance Prediction</title>
<style>
  body { font-family: Arial, sans-serif; background: #f5f5f5; }
  .container { max-width: 600px; margin: 2rem auto; background: #fff; padding: 1.5rem; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.1); }
  label { display:block; margin-top:1rem; font-weight:bold; }
  input, select { width:100%; padding:0.5rem; margin-top:0.3rem; border:1px solid #ccc; border-radius:4px; }
  button { margin-top:1rem; padding:0.7rem 1.2rem; background:#3498db; color:#fff; border:none; cursor:pointer; border-radius:4px; }
  .result { margin-top:1.5rem; padding:1rem; background:#e8f8f5; border-left:4px solid #1abc9c; }
  .error { color:#c0392b; margin-top:1rem; }
</style>
</head>
<body>
<div class="container">
  <h1>Academic Performance Prediction</h1>
  {{errorMessage}}
  <form method="post">
    <label>Student ID</label><input type="number" name="student_id" required value="{{student_id}}">
    <label>Course Code</label><input type="text" name="course_code" required value="{{course_code}}">
    <label>Has Prerequisites?</label>
    <select name="has_prerequisites">
      <option value="1" {{prereq_yes}}>Yes</option>
      <option value="0" {{prereq_no}}>No</option>
    </select>
    <label>Credits</label><input type="number" step="0.5" name="credits" min="1" max="6" value="{{credits}}">
    <label>Attendance Rate (%)</label><input type="number" name="attendance" min="0" max="100" required value="{{attendance}}">
    <label>Midterm Score</label><input type="number" name="midterm" min="0" max="100" value="{{midterm}}">
    <label>Final Score</label><input type="number" name="final" min="0" max="100" value="{{final}}">
    <label>Assignment Score</label><input type="number" name="assignment" min="0" max="100" value="{{assignment}}">
    <button type="submit">Predict</button>
  </form>
  {{predictionResult}}
</div>
</body>
</html>
`;

// Main route
app.get("/", (req, res) => {
  const html = HTML_TEMPLATE.replace("{{errorMessage}}", "")
    .replace("{{student_id}}", "")
    .replace("{{course_code}}", "")
    .replace("{{prereq_yes}}", "")
    .replace("{{prereq_no}}", "selected")
    .replace("{{credits}}", "3")
    .replace("{{attendance}}", "80")
    .replace("{{midterm}}", "")
    .replace("{{final}}", "")
    .replace("{{assignment}}", "")
    .replace("{{predictionResult}}", "");

  res.send(html);
});

app.post("/", (req, res) => {
  let prediction = null;
  let probability = null;
  let errorMessage = "";
  const date = new Date().toLocaleString();

  try {
    const {
      student_id,
      course_code,
      has_prerequisites,
      credits,
      attendance,
      midterm,
      final,
      assignment,
    } = req.body;

    const sid = parseInt(student_id);
    const code = course_code.trim();
    const pre = parseInt(has_prerequisites);
    const cr = parseFloat(credits);
    const att = parseFloat(attendance);

    // Extract historical features for this student
    const hist = getHistoryFeatures(sid, code);

    // Use historical averages for missing scores
    const mid = midterm ? parseFloat(midterm) : hist.past_avg_midterm_score;
    const fin = final ? parseFloat(final) : hist.past_avg_final_score;
    const asm = assignment
      ? parseFloat(assignment)
      : hist.past_avg_assignment_score;

    console.log(
      `Scores for student ${sid} - Midterm: ${mid.toFixed(
        2
      )}, Final: ${fin.toFixed(2)}, Assignment: ${asm.toFixed(2)}`
    );

    // Create feature array
    const featureData = {
      has_prerequisites: pre,
      credits: cr,
      attendance_rate: att,
      midterm_score: mid,
      final_score: fin,
      assignment_score: asm,
      ...hist,
    };

    // Order features correctly
    const orderedFeatures = FEATURES.map(
      (feature) => featureData[feature] || 0
    );

    // Make prediction
    const proba = model.predict_proba([orderedFeatures])[0][1];
    prediction = proba >= 0.5 ? "Yes" : "No";
    probability = proba;

    console.log(
      `PREDICTION: Student ${sid}, Course ${code}, Probability: ${proba.toFixed(
        4
      )}, Result: ${prediction}`
    );
  } catch (error) {
    console.error("Prediction error:", error);
    errorMessage =
      '<div class="error">Error during prediction. Please check inputs.</div>';
  }

  // Build prediction result HTML
  let predictionResult = "";
  if (prediction) {
    const resultClass =
      prediction === "Yes" ? "Likely to Pass 🎉" : "At Risk of Failing ⚠️";
    predictionResult = `
            <div class="result">
                <h2>${resultClass}</h2>
                <p><strong>Probability:</strong> ${(probability * 100).toFixed(
                  1
                )}%</p>
                <p><small>Prediction time: ${date}</small></p>
            </div>
        `;
  }

  // Render template with form data and results
  const html = HTML_TEMPLATE.replace("{{errorMessage}}", errorMessage)
    .replace("{{student_id}}", req.body.student_id || "")
    .replace("{{course_code}}", req.body.course_code || "")
    .replace(
      "{{prereq_yes}}",
      req.body.has_prerequisites === "1" ? "selected" : ""
    )
    .replace(
      "{{prereq_no}}",
      req.body.has_prerequisites === "0" ? "selected" : ""
    )
    .replace("{{credits}}", req.body.credits || "3")
    .replace("{{attendance}}", req.body.attendance || "80")
    .replace("{{midterm}}", req.body.midterm || "")
    .replace("{{final}}", req.body.final || "")
    .replace("{{assignment}}", req.body.assignment || "")
    .replace("{{predictionResult}}", predictionResult);

  res.send(html);
});

// Initialize and start server
async function init() {
  console.log("Loading data and models...");
  studentData = await loadStudentData();
  FEATURES = loadFeatures();
  model = loadModel();

  console.log("Model and features loaded successfully");

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

init().catch(console.error);
