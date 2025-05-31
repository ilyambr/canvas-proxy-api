// api/grades.js

const express = require('express');
const fetch = require('node-fetch');
const serverless = require('serverless-http');

const app = express();

// ─── Manually inject CORS headers for EVERY request ───────────────────────────
app.use((req, res, next) => {
  // Allow only your GitHub Pages origin
  res.setHeader('Access-Control-Allow-Origin', 'https://ilyambr.me');
  // Allow POST and OPTIONS (preflight)
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // Allow JSON content-type
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // If this is a preflight request, just return 200 immediately:
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// ─── Built‐in JSON parser ───────────────────────────────────────────────────────
app.use(express.json());

// ─── Main POST route at “/” ────────────────────────────────────────────────────
// Because Vercel auto‐routes “api/grades.js” → “https://<your-app>.vercel.app/api/grades”
// inside this file, we only register “app.post('/')”.
app.post('/', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    // 1) Fetch the list of courses for this student
    const courseRes = await fetch(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    if (!courseRes.ok) {
      // If token is invalid or expired, Canvas returns 401/403 or similar:
      throw new Error(`Canvas returned ${courseRes.status} when fetching courses`);
    }
    const courses = await courseRes.json();

    // 2) For each course, fetch the enrollment/grades
    const grades = [];
    for (const course of courses) {
      const enrollRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/enrollments`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!enrollRes.ok) {
        // If Canvas returns an error for this course, skip it.
        continue;
      }
      const enrollments = await enrollRes.json();
      const student = enrollments.find((e) => e.type === 'StudentEnrollment');
      if (student && student.grades) {
        grades.push({
          course: course.name,
          grade: student.grades.current_grade || 'N/A',
          score: student.grades.current_score || 'N/A'
        });
      }
    }

    // 3) Return the array of { course, grade, score } back to the client
    return res.json(grades);
  } catch (err) {
    // If anything goes wrong (invalid token, network error, etc.), return 500 + message
    return res.status(500).json({ error: err.message });
  }
});

// ─── Wrap the Express app in “serverless-http” so Vercel can run it properly ────
module.exports = serverless(app);
