// api/grades.js
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const serverless = require("serverless-http");

const app = express();

// allow your front end (https://ilyambr.me) to call this function
app.use(
  cors({
    origin: "https://ilyambr.me",
    methods: ["POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.options("*", cors());

app.use(express.json());

// You can also put your own Canvas user_id in an env var if it ever changes:
const STUDENT_CANVAS_ID = process.env.CANVAS_USER_ID || "13888";

// Helper: fetch JSON and throw if non-OK
async function fetchJSON(url, token) {
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Canvas API ${r.status}: ${text}`);
  }
  return r.json();
}

// Main POST endpoint
app.post("/api/grades", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Missing token" });
  }

  try {
    // 1) Get list of all courses
    const courses = await fetchJSON(
      "https://providencepsd.instructure.com/api/v1/courses",
      token
    );

    // 2) For each course, call the gradebook_history endpoint
    const results = await Promise.all(
      courses.map(async (course) => {
        const course_id = course.id;

        // 2a) Hit the gradebook_history URL for that course + student
        //     We ask for per_page=100 just to get all records; normally you only need the last page.
        const historyURL = `https://providencepsd.instructure.com/api/v1/courses/${course_id}/gradebook_history?student[]=${STUDENT_CANVAS_ID}&per_page=100&page=1`;
        let historyEntries = [];
        try {
          historyEntries = await fetchJSON(historyURL, token);
        } catch (err) {
          // If a particular course has no gradebook_history (e.g. you’re not enrolled yet),
          // we’ll treat it as “no grade found.” But still include the course_name.
          console.warn(
            `Failed to fetch history for course ${course_id}: ${err.message}`
          );
        }

        // 2b) Find the most recent “graded” entry
        //     The Canvas Gradebook History entries come back oldest→newest by default.
        //     We look from the end for the first `workflow_state === "graded" && published === true`.
        let finalGrade = null;
        for (let i = historyEntries.length - 1; i >= 0; i--) {
          const e = historyEntries[i];
          if (e.workflow_state === "graded" && e.published_grade != null) {
            finalGrade = {
              published_grade: e.published_grade,
              published_score: e.published_score,
            };
            break;
          }
        }

        // If we never found a `published_grade`, render it as “N/A.”
        if (!finalGrade) {
          finalGrade = { published_grade: "N/A", published_score: "N/A" };
        }

        return {
          course_id: course_id,
          course_name: course.name,
          final_grade: finalGrade.published_grade,
          final_score: finalGrade.published_score,
        };
      })
    ); // end Promise.all

    // 3) Return everything as JSON
    res.json(results);
  } catch (err) {
    console.error("❌ Proxy error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Wrap in serverless and export
module.exports = serverless(app);
