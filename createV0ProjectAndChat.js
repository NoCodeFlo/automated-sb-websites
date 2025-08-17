import 'dotenv/config';
import fs from 'fs/promises';

const V0_API_KEY = process.env.V0_API_KEY;
const rootUrl = "https://lichtweg.li/";
const slug = "lichtweg_li"; // hardcoded to match your dev prompt file
const devPromptFile = `${slug}_developer_prompt.txt`;

if (!V0_API_KEY) {
  console.error("❌ Missing V0_API_KEY in .env");
  process.exit(1);
}

async function createProject(projectName) {
  const res = await fetch("https://api.v0.dev/v1/projects", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${V0_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: projectName })
  });

  if (!res.ok) throw new Error(`Create project failed: ${await res.text()}`);
  return (await res.json()).id;
}

async function createChat(projectId, developerPrompt) {
    const res = await fetch("https://api.v0.dev/v1/chats", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${V0_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        projectId,
        message: developerPrompt // plain string, no role/content structure
      })
    });
  
    if (!res.ok) throw new Error(`Create chat failed: ${await res.text()}`);
    return (await res.json()).id;
  }

(async () => {
  try {
    const promptContent = await fs.readFile(devPromptFile, 'utf-8');

    const projectName = `Website rebuild: ${rootUrl}`;
    const projectId = await createProject(projectName);
    console.log("✅ Project created:", projectId);

    const chatId = await createChat(projectId, promptContent);
    console.log("✅ Chat created:", chatId);

    await fs.writeFile(`${slug}_v0_projectId.txt`, projectId);
    await fs.writeFile(`${slug}_v0_chatId.txt`, chatId);
  } catch (err) {
    console.error("❌ Error:", err.message);
  }
})();