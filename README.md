
# Canvas Proxy API

This is a Node.js proxy for accessing Canvas LMS API from a frontend (e.g. GitHub Pages) that would normally get blocked by CORS.

## Deploy Instructions (Vercel)

1. Go to https://vercel.com
2. Click "Import Project" > "Import Git Repository"
3. Upload this folder as a new GitHub repo or drag into Vercel if uploading manually
4. Vercel will auto-detect and deploy your proxy
5. Use: https://your-deployment.vercel.app/api/grades

POST JSON: { "token": "your_canvas_token" }
