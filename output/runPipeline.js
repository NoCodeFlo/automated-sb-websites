export async function runWebsitePipeline(rootUrl) {
    // Move all your logic from the current `main()` function here
    return {
        url,
        slug: urlSlug,
        files: {
          analysisPrompt: `${projectDir}/${urlSlug}_full_analysis_prompt.txt`,
          developerPrompt: `${projectDir}/${urlSlug}_developer_prompt.txt`,
          screenshotDir: screenshotDir
        },
        vercel: {
          projectId: createdProjectId,
          chatId: createdChatId
        }
      };   // Use `return` to pass results (e.g. filenames, URLs, project/chat IDs)
  }