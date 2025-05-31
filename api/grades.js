// File: api/grades.js

// ─── IMPORTANT: Use an ES Module "export default" function ─────────────────────
// Vercel’s Node-18 Serverless Runtime expects this format. If you use
// module.exports, the platform may not run your code exactly as you wrote it.

export default async function handler(req, res) {
  // ─── Step A: Manually add CORS headers for both OPTIONS and POST ─────────
  res.setHeader('Access-Control-Allow-Origin', 'https://ilyambr.me');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ─── Step B: If this is a CORS preflight (OPTIONS), return 200 immediately ──
  if (req.method === 'OPTIONS') {
    // No body needed—just the headers above satisfy the browser’s preflight
    return res.status(200).end();
  }

  // ─── Step C: Only accept POST for the actual grades request ────────────────
  if (req.method !== 'POST') {
    // Tell the client that only POST and OPTIONS are allowed
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ─── Step D: Read + parse the JSON body ────────────────────────────────────
  let rawBody = '';
  try {
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', () => {
        resolve();
      });
      req.on('error', (err) => {
        reject(err);
      });
    });
  } catch (err) {
    return res.status(400).json({ error: 'Error reading request body' });
  }

  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const token = body.token;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing token' });
  }

  // ─── Step E: Proxy logic to Canvas, collect courses + grades ────────────────
  try {
    // 1) Fetch the list of courses for this student
    const courseRes = await fetch(
      'https://providencepsd.instructure.com/api/v1/courses',
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    if (!courseRes.ok) {
      throw new Error(`Canvas returned ${courseRes.status} when fetching courses`);
    }
    const courses = await courseRes.json();

    // 2) Loop through each course, fetch enrollments, and extract grades
    const grades = [];
    for (const course of courses) {
      const enrollRes = await fetch(
        `https://providencepsd.instructure.com/api/v1/courses/${course.id}/enrollments`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!enrollRes.ok) {
        // If Canvas returns an error for this course’s enrollments, skip it
        continue;
      }
      const enrollments = await enrollRes.json();
      const studentEntry = enrollments.find((e) => e.type === 'StudentEnrollment');
      if (studentEntry && studentEntry.grades) {
        grades.push({
          course: course.name,
          grade: studentEntry.grades.current_grade || 'N/A',
          score: studentEntry.grades.current_score || 'N/A',
        });
      }
    }

    // 3) Return the array of { course, grade, score } objects
    return res.status(200).json(grades);
  } catch (err) {
    // If anything breaks (invalid token, network error, etc.), send back a 500
    return res.status(500).json({ error: err.message });
  }
}
