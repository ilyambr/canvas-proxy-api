// File: api/grades.js

const express = require('express');
const fetch = require('node-fetch'); // If using Node18+, you can drop this line.
const cors = require('cors');
const serverless = require('serverless-http');

const app = express();

// Only allow your front-end origin to call us:
app.use(
  cors({
    origin: 'https://ilyambr.me',
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.options('/api/grades', cors()); // enable preflight

app.use(express.json());

/**
 * Helper: fetch JSON and throw if not ok.
 */
async function fetchJsonOrThrow(url, options = {}) {
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Fetch to ${url} failed: ${resp.status} ${resp.statusText} – ${text}`);
  }
  return resp.json();
}

app.post('/api/grades', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }

  try {
    // 1) First, fetch the full list of courses
    const courses = await fetchJsonOrThrow(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    // courses = [ { id: 34917, name: "...", enrollments: [ {user_id: 13888, ...}, ... ] }, ... ]

    if (!Array.isArray(courses) || courses.length === 0) {
      return res.json([]); // no courses at all
    }

    // 2) Extract the student’s user_id from the first enrollment in the first course:
    //    (every course has an "enrollments" array; pick the first enrollment of type StudentEnrollment)
    let studentId = null;
    for (const enr of courses[0].enrollments || []) {
      if (enr.type === 'StudentEnrollment') {
        studentId = enr.user_id;
        break;
      }
    }
    if (!studentId) {
      // If we didn’t find student_id in the first course, try scanning them all:
      outerLoop: 
      for (const course of courses) {
        for (const enr of course.enrollments || []) {
          if (enr.type === 'StudentEnrollment') {
            studentId = enr.user_id;
            break outerLoop;
          }
        }
      }
    }
    if (!studentId) {
      throw new Error('Unable to determine your Canvas user_id from any enrollment.');
    }

    const results = [];

    // 3) For each course, fetch assignments + gradebook_history
    for (const course of courses) {
      const courseId = course.id;
      const courseName = course.name;

      // A) Fetch this course’s assignments:
      let assignmentList = [];
      try {
        const rawAssigns = await fetchJsonOrThrow(
          `https://providencepsd.instructure.com/api/v1/courses/${courseId}/assignments`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        // rawAssigns is an Array; map to minimal fields:
        assignmentList = rawAssigns.map((a) => ({
          id: a.id,
          name: a.name,
          points_possible: a.points_possible,
        }));
      } catch (err) {
        console.warn(`Could not fetch assignments for course ${courseId}: ${err.message}`);
        assignmentList = [];
      }

      // B) Fetch this course’s gradebook history (paginated). We want to find the most recent
      //    grade history entry whose column_title is "Final Score" for our student.
      let finalGrade = null;

      try {
        let page = 1;
        let morePages = true;
        let allHistoryEntries = [];

        while (morePages) {
          const historyPage = await fetchJsonOrThrow(
            `https://providencepsd.instructure.com/api/v1/courses/${courseId}/gradebook_history?student[]=`
              + encodeURIComponent(studentId)
              + `&per_page=100&page=${page}`,
            {
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          // historyPage is an array of history objects. If it’s empty, we stop:
          if (!Array.isArray(historyPage) || historyPage.length === 0) {
            morePages = false;
          } else {
            allHistoryEntries = allHistoryEntries.concat(historyPage);
            page += 1;
            // If Canvas returns fewer than 100 entries, we’re on the last page:
            if (historyPage.length < 100) {
              morePages = false;
            }
          }
        }

        // Each history entry looks like:
        // {
        //   id: 7272727,
        //   user_id: 13888,
        //   column_title: "Final Score",
        //   new_grade: "90.94",         <— the new final grade as a string
        //   old_grade: "0",
        //   recorded_at: "2025-05-24T02:00:00Z",
        //   ...
        // }
        // Find all entries where column_title === "Final Score", then pick the one with the latest timestamp:
        const finalScoreEntries = allHistoryEntries.filter(
          (h) => h.column_title === 'Final Score'
        );

        if (finalScoreEntries.length > 0) {
          // Sort by recorded_at descending, take the first:
          finalScoreEntries.sort((a, b) => {
            return new Date(b.recorded_at) - new Date(a.recorded_at);
          });
          finalGrade = finalScoreEntries[0].new_grade;
        } else {
          // If no "Final Score" event, maybe fall back to "Current Score" or something else:
          // For now, leave finalGrade = null
          finalGrade = null;
        }
      } catch (err) {
        console.warn(`Could not fetch gradebook history for course ${courseId}: ${err.message}`);
        finalGrade = null;
      }

      // 4) Push for this course:
      results.push({
        course_id: courseId,
        course_name: courseName,
        final_grade: finalGrade,     // will be a string like "90.94" or null
        assignments: assignmentList,  // array of { id, name, points_possible }
      });
    }

    // 5) Return the final array
    return res.json(results);
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = serverless(app);
