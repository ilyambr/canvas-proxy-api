// File: api/grades.js

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const serverless = require("serverless-http");

const app = express();

// Only allow your front-end origin (adjust if your HTML is hosted somewhere else):
const corsOptions = {
  origin: "https://ilyambr.me",   // <-- change to your exact front-end domain if different
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
};
app.use(cors(corsOptions));
app.options("/api/grades", cors(corsOptions));

app.use(express.json());

app.post("/api/grades", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }

  try {
    // 1. Fetch the current user's profile to extract their Canvas user ID:
    const meRes = await fetch("https://providencepsd.instructure.com/api/v1/users/self", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!meRes.ok) {
      const txt = await meRes.text();
      throw new Error(`Failed to fetch /users/self → ${meRes.status}: ${txt}`);
    }
    const meJson = await meRes.json();
    const userId = meJson.id;
    if (!userId) {
      throw new Error("Could not determine user ID from Canvas response.");
    }

    // 2. Fetch the list of all courses the user is enrolled in:
    const courseRes = await fetch("https://providencepsd.instructure.com/api/v1/courses", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!courseRes.ok) {
      const txt = await courseRes.text();
      throw new Error(`Failed to fetch /courses → ${courseRes.status}: ${txt}`);
    }
    const courses = await courseRes.json();
    if (!Array.isArray(courses)) {
      throw new Error("Courses response was not an array.");
    }

    // 3. For each course, pull its gradebook_history for this user:
    const results = [];

    for (const course of courses) {
      const courseId = course.id;
      const courseName = course.name;

      // Hit the Gradebook History endpoint, filtering by our student ID:
      const histURL =
        `https://providencepsd.instructure.com/api/v1/courses/${courseId}/gradebook_history`
        + `?student[]=${userId}`
        + `&per_page=100&page=1`;

      const histRes = await fetch(histURL, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!histRes.ok) {
        // If that course returns an error (e.g. not a student in that course), skip it.
        console.warn(`⚠️  Could not fetch gradebook_history for course ${courseId}. Status ${histRes.status}`);
        results.push({
          course_id: courseId,
          course_name: courseName,
          final_grade: "N/A",
          final_score: "N/A"
        });
        continue;
      }

      const history = await histRes.json();
      let finalGrade = "N/A";
      let finalScore = "N/A";

      // history is an array of objects like:
      // { id, grade, score, assignment_id, published_score, published_grade, created_at, ... }
      if (Array.isArray(history) && history.length > 0) {
        // Sort by created_at ascending, then pick the last entry:
        history.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const lastEntry = history[history.length - 1];
        finalGrade = lastEntry.published_grade ?? lastEntry.grade ?? "N/A";
        finalScore = lastEntry.published_score ?? lastEntry.score ?? "N/A";
      }

      results.push({
        course_id: courseId,
        course_name: courseName,
        final_grade: finalGrade,
        final_score: finalScore
      });
    }

    // 4. Return JSON array of { course_id, course_name, final_grade, final_score }
    return res.json(results);

  } catch (e) {
    console.error("❌ Error in /api/grades:", e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = serverless(app);
