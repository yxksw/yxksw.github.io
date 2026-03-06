const fs = require("fs");
const path = require("path");

const GH_TOKEN = process.env.GH_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || "yxksw";
const GITHUB_API_BASE = "https://api.github.com";

const headers = {
  Accept: "application/vnd.github.v3+json",
  "User-Agent": "GitHub-Pages-Data-Fetcher",
};

if (GH_TOKEN) {
  headers["Authorization"] = `token ${GH_TOKEN}`;
  console.log("Using authenticated GitHub API requests");
} else {
  console.log(
    "Warning: No GH_TOKEN provided, using unauthenticated requests (rate limited)",
  );
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...headers, ...options.headers },
      });

      if (response.status === 429) {
        const delay = Math.pow(2, i) * 1000;
        console.log(
          `Rate limited, waiting ${delay}ms before retry ${i + 1}/${retries}...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Request failed, retry ${i + 1}/${retries}...`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
}

async function fetchAllRepos() {
  console.log("Fetching all repositories...");
  const repos = await fetchWithRetry(
    `${GITHUB_API_BASE}/users/${GITHUB_USERNAME}/repos?sort=updated&direction=desc&per_page=100`,
  );

  // Filter out specific repos
  const filteredRepos = repos.filter(
    (repo) => repo.name !== "yuazhi" && repo.full_name !== "yuazhi/yuazhi",
  );

  console.log(`Fetched ${filteredRepos.length} repositories`);
  return filteredRepos;
}

async function fetchRepoDetails(repo) {
  console.log(`Fetching details for ${repo.name}...`);

  const [commits, languages, contributors] = await Promise.all([
    fetchWithRetry(
      `${GITHUB_API_BASE}/repos/${GITHUB_USERNAME}/${repo.name}/commits?per_page=1`,
    ).catch(() => []),
    fetchWithRetry(
      `${GITHUB_API_BASE}/repos/${GITHUB_USERNAME}/${repo.name}/languages`,
    ).catch(() => ({})),
    fetchWithRetry(
      `${GITHUB_API_BASE}/repos/${GITHUB_USERNAME}/${repo.name}/contributors`,
    ).catch(() => []),
  ]);

  return {
    ...repo,
    lastCommit: commits[0] || null,
    languages,
    contributors,
  };
}

async function fetchUserEvents() {
  console.log("Fetching user events...");
  const events = await fetchWithRetry(
    `${GITHUB_API_BASE}/users/${GITHUB_USERNAME}/events?per_page=100`,
  );
  console.log(`Fetched ${events.length} events`);
  return events;
}

async function fetchUserForks() {
  console.log("Fetching user forks...");
  const forks = await fetchWithRetry(
    `${GITHUB_API_BASE}/users/${GITHUB_USERNAME}/repos?type=fork&per_page=100&sort=updated`,
  );
  console.log(`Fetched ${forks.length} forks`);
  return forks;
}

async function fetchUserStars() {
  console.log("Fetching user stars...");
  const stars = await fetchWithRetry(
    `${GITHUB_API_BASE}/users/${GITHUB_USERNAME}/starred?per_page=100&sort=updated`,
  );
  console.log(`Fetched ${stars.length} starred repos`);
  return stars;
}

async function fetchAllCommits(repos) {
  console.log("Fetching all commits...");
  const allCommits = [];

  // Fetch commits for each repo (limit to 30 to avoid rate limits)
  for (const repo of repos.slice(0, 30)) {
    try {
      console.log(`Fetching commits for ${repo.name}...`);
      const commits = await fetchWithRetry(
        `${GITHUB_API_BASE}/repos/${GITHUB_USERNAME}/${repo.name}/commits?per_page=5&author=${GITHUB_USERNAME}`,
      );

      // Add repo info to each commit
      const commitsWithRepo = commits.map((commit) => ({
        ...commit,
        repo: repo.name,
        repoFullName: repo.full_name,
      }));

      allCommits.push(...commitsWithRepo);

      // Add longer delay to avoid rate limiting (especially without token)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`Error fetching commits for ${repo.name}:`, error.message);
      // If we hit rate limit, stop fetching more commits
      if (error.message.includes("rate limit")) {
        console.log("Rate limit hit, stopping commits fetch...");
        break;
      }
    }
  }

  // Sort by date descending
  allCommits.sort(
    (a, b) =>
      new Date(b.commit.committer.date) - new Date(a.commit.committer.date),
  );

  console.log(`Fetched ${allCommits.length} total commits`);
  return allCommits.slice(0, 100); // Return top 100 recent commits
}

async function main() {
  try {
    console.log("Starting GitHub data fetch...");
    console.log(`Target user: ${GITHUB_USERNAME}`);

    // Fetch all data
    const repos = await fetchAllRepos();

    // Fetch details for each repo (with rate limiting)
    const repoDetails = [];
    for (const repo of repos.slice(0, 30)) {
      // Limit to 30 repos to avoid rate limits
      try {
        const details = await fetchRepoDetails(repo);
        repoDetails.push(details);
        // Add delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(
          `Error fetching details for ${repo.name}:`,
          error.message,
        );
        repoDetails.push(repo);
      }
    }

    const [events, forks, stars, allCommits] = await Promise.all([
      fetchUserEvents(),
      fetchUserForks(),
      fetchUserStars(),
      fetchAllCommits(repos),
    ]);

    // Prepare data object
    const githubData = {
      timestamp: new Date().toISOString(),
      username: GITHUB_USERNAME,
      repos: repoDetails,
      events,
      forks,
      stars,
      commits: allCommits,
    };

    // Save to file
    const outputPath = path.join(__dirname, "..", "github-data.json");
    fs.writeFileSync(outputPath, JSON.stringify(githubData, null, 2));

    console.log(`\n✅ Data saved to github-data.json`);
    console.log(`   - Repositories: ${repoDetails.length}`);
    console.log(`   - Events: ${events.length}`);
    console.log(`   - Forks: ${forks.length}`);
    console.log(`   - Stars: ${stars.length}`);
    console.log(`   - Commits: ${allCommits.length}`);
  } catch (error) {
    console.error("Error fetching GitHub data:", error);
    process.exit(1);
  }
}

main();
