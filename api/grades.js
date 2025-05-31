// File: api/grades.js

// We export a single CommonJS function. Vercel will call this for any
// request to https://<your-VERCEL-DOMAIN>/api/grades
module.exports = async function (req, res) {
  // ─── Step A: Always set CORS headers first ────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', 'https://ilyambr.me');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ─── Step B: If this is the CORS preflight (OPTIONS), immediately return 200 ─
  if (req.method === 'OPTIONS') {
    // The browser’s preflight sees 200 + the CORS headers above → done.
    return res.status(200).end();
  }

  // ─── Step C: Only allow POST from here on ──────────────────────────────────
  if (req.method !== 'POST') {
    // Inform the client that only POST/OPTIONS are allowed.
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ─── Step D: Read + parse the JSON body manually ────────────────────────────
  let bodyData = '';
  try {
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => (bodyData += chunk));
      req.on('end', () => {
        try {
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', (err) => reject(err));
    });
  } catch (err) {
    return res.status(400).json({ error: 'Error reading request body' });
  }

  let parsed;
  try {
    parsed = JSON.parse(bodyData || '{}');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const token = parsed.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  // ─── Step E: Proxy to Canvas and build “grades” array ────────────────────────
  try {
    // 1) Fetch course list from Canvas
    const courseRes = await fetch(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    if (!courseRes.ok) {
      throw new Error(`Canvas returned ${courseRes.status} when fetching courses`);
    }
    const courses = await courseRes.json();

    // 2) For each course, fetch enrollments (to find the StudentEnrollment + grades)
    const grades = [];
    for (const course of courses) {
      const enrollRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/enrollments`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!enrollRes.ok) {
        // If Canvas says 401/403/404 for this course’s enrollments, skip it
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

    // 3) Return the JSON array of grades
    return res.status(200).json(grades);
  } catch (err) {
    // On any error (Canvas token invalid, network error, etc.), return 500 + message
    return res.status(500).json({ error: err.message });
  }
};
