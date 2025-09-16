#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fetchJson } from '../utils/http.js';
import { waitForChatVersion } from '../utils/v0Platform.js';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '-n') { args.name = argv[++i]; continue; }
    if (a.startsWith('--name=')) { args.name = a.split('=')[1]; continue; }

    if (a === '--message' || a === '-m') { args.message = argv[++i]; continue; }
    if (a.startsWith('--message=')) { args.message = a.split('=')[1]; continue; }

    if (a === '--message-file' || a === '-f') { args.messageFile = argv[++i]; continue; }
    if (a.startsWith('--message-file=')) { args.messageFile = a.split('=')[1]; continue; }

    if (a === '--json') { args.pretty = true; continue; }
    if (a === '--pretty') { args.pretty = true; continue; }

    if (a === '--base-url') { args.baseUrl = argv[++i]; continue; }
    if (a.startsWith('--base-url=')) { args.baseUrl = a.split('=')[1]; continue; }

    if (a === '--help' || a === '-h') { args.help = true; continue; }
    args._.push(a);
  }
  return args;
}

function printHelp() {
  const help = `
Usage: v0-create-deploy --name <project-name> (--message <text> | --message-file <path>) [--json] [--base-url <url>]

Flags:
  -n, --name           Project name (required)
  -m, --message        Initial chat message text
  -f, --message-file   Path to a file containing the message (UTF-8)
      --json           Pretty-print JSON output
      --base-url       Override API base URL (default: https://api.v0.dev/v1)
  -h, --help           Show help
`;
  process.stdout.write(help);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate required flags
  if (!args.name) {
    console.error('Missing required flag: --name');
    process.exit(1);
  }

  let message = args.message || '';
  if (!message && args.messageFile) {
    const filePath = path.resolve(process.cwd(), args.messageFile);
    try {
      message = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      console.error(`Failed to read --message-file: ${err.message}`);
      process.exit(1);
    }
  }
  if (!message) {
    console.error('Missing message: provide --message or --message-file');
    process.exit(1);
  }

  try {
    const baseUrl = args.baseUrl;

    // 1) Create project
    const projIdem = crypto.createHash('sha256').update(`project:${args.name}`).digest('hex');
    const projectRes = await fetchJson('POST', '/projects', {
      baseUrl,
      body: { name: args.name },
      idempotencyKey: projIdem,
    });
    const projectId = projectRes?.project?.id || projectRes?.id;
    if (!projectId) {
      throw new Error('Project creation returned no id');
    }

    // 2) Create chat
    const chatIdem = crypto.createHash('sha256').update(`chat:${projectId}:${message}`).digest('hex');
    const chatRes = await fetchJson('POST', '/chats', {
      baseUrl,
      body: { projectId, message },
      idempotencyKey: chatIdem,
    });
    const chatId = chatRes?.id || chatRes?.chat?.id || chatRes?.data?.id;
    const versionId = chatRes?.latestVersion?.id || chatRes?.chat?.latestVersion?.id;
    if (!chatId) {
      throw new Error('Chat creation returned no id');
    }
    let finalVersionId = versionId;
    if (!finalVersionId) {
      // Wait for the initial version to complete
      finalVersionId = await waitForChatVersion(chatId, { baseUrl });
    }

    // 3) Create deployment from the chat version
    const deployRes = await fetchJson('POST', '/deployments', {
      baseUrl,
      body: { projectId, chatId, versionId: finalVersionId },
    });

    const deploymentId = deployRes?.id || deployRes?.deployment?.id;
    const publicUrl = deployRes?.webUrl || deployRes?.deployment?.webUrl;
    const inspectorUrl = deployRes?.inspectorUrl || deployRes?.deployment?.inspectorUrl;

    const result = {
      projectId,
      chatId,
      versionId: finalVersionId,
      deploymentId,
      publicUrl,
      inspectorUrl,
    };

    const output = args.pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);
    process.stdout.write(output + '\n');
    process.exit(0);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(msg);
    process.exit(1);
  }
}

main();
