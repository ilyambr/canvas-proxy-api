// File: api/grades.js

const express = require('express');
const fetch = require('node-fetch'); // If your environment is Node 18+, you can drop this import
const cors = require('cors');
const serverless = require('serverless-http');

const app = express();

app.use(
  cors({
    origin: 'https://ilyambr.me',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.options('/api/grades', cors()); // handle preflight
app.use(express.json());

/** Helper: fetch JSON or throw */
async function fetchJsonOrThrow(url, options = {}) {
  const r = await fetch(url, options);
  if (!r.ok) {
    // Try to read the error body for debugging
    let bodyText;
    try { bodyText = await r.text(); } catch { bodyText = '<no body>'; }
    throw new Error(`Request to ${url} failed: ${r.status} ${r.statusText} → ${bodyText}`);
  }
  return r.json();
}

app.post('/api/grades', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    //
    // 1) Fetch all courses
    //
    const courses = await fetchJsonOrThrow(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    // courses is an array of objects like { id: 34917, name: "ITALIAN II-CAPRIO", enrollments: [...] }

    if (!Array.isArray(courses) || courses.length === 0) {
      // No courses at all
      return res.json([]);
    }

    //
    // 2) Extract your user_id from the first StudentEnrollment we find
    //
    let studentId = null;
    outerLoop:
    for (const course of courses) {
      if (Array.isArray(course.enrollments)) {
        for (const enr of course.enrollments) {
          if (enr.type === 'StudentEnrollment') {
            studentId = enr.user_id;
            break outerLoop;
          }
        }
      }
    }
    if (!studentId) {
      throw new Error('Could not find your Canvas user_id in any enrollment');
    }

    //
    // 3) For each course, fetch that course’s gradebook_history (just page=1, up to 100 entries)
    //
    const results = [];

    for (const course of courses) {
      const courseId = course.id;
      const courseName = course.name;

      let historyPage = [];
      let finalGrade = null;

      try {
        // We only pull the first page (per_page=100). If you expect >100 history entries,
        // you can loop `&page=1`, `&page=2`… just like before. Here we assume ≤100.
        historyPage = await fetchJsonOrThrow(
          `https://providencepsd.instructure.com/api/v1/courses/${courseId}/gradebook_history`
          + `?student[]=${encodeURIComponent(studentId)}`
          + `&per_page=100&page=1`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        // Now historyPage is an array like:
        // [ { id: 7272727, user_id: 13888, column_title: "Participation", new_grade: "32", recorded_at: "…" },
        //   { id: 7272728, user_id: 13888, column_title: "Final Score", new_grade: "90.94", recorded_at: "2025-05-24T02:00:00Z" },
        //   … up to 100 items … ]
        //
        // We look for the latest entry where column_title === "Final Score".
        // (Canvas always writes a “Final Score” row when it finalizes your course grade.)

        // Filter only the "Final Score" entries
        const finalScoreEntries = (historyPage || []).filter(
          (h) => h.column_title === 'Final Score'
        );

        if (finalScoreEntries.length > 0) {
          // Sort by recorded_at descending
          finalScoreEntries.sort((a, b) =>
            new Date(b.recorded_at) - new Date(a.recorded_at)
          );
          finalGrade = finalScoreEntries[0].new_grade; // e.g. "90.94" or "B+" etc.
        }
      } catch (err) {
        console.warn(`Could not fetch gradebook_history for course ${courseId}:`, err.message);
        historyPage = [];  // leave it empty
        finalGrade = null;
      }

      results.push({
        course_id: courseId,
        course_name: courseName,
        final_grade: finalGrade,      // string or null
        history: historyPage,         // array of up to 100 history objects
      });
    }

    return res.json(results);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = serverless(app);
