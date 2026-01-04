// scripts/generate_repos.js
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.error('GITHUB_TOKEN not provided');
  process.exit(1);
}

const [owner] = (process.env.GITHUB_REPOSITORY || '').split('/');
if (!owner) {
  console.error('GITHUB_REPOSITORY not provided');
  process.exit(1);
}

const GRAPHQL_URL = 'https://api.github.com/graphql';

async function graphql(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': `${owner}-repo-generator`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GraphQL request failed: ${res.status} ${txt}`);
  }
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function fetchAllRepos() {
  let repos = [];
  let cursor = null;
  while (true) {
    const q = `
    query ($owner: String!, $cursor: String) {
      user(login: $owner) {
        repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            name
            url
            stargazerCount
            defaultBranchRef {
              name
              target {
                ... on Commit {
                  history {
                    totalCount
                  }
                }
              }
            }
            description
            updatedAt
          }
        }
      }
    }`;
    const variables = { owner, cursor };
    const result = await graphql(q, variables);
    const nodes = result.user.repositories.nodes;
    repos = repos.concat(nodes);
    if (!result.user.repositories.pageInfo.hasNextPage) break;
    cursor = result.user.repositories.pageInfo.endCursor;
  }
  return repos;
}

function formatRepoMd(repo) {
  const name = repo.name;
  const url = repo.url;
  const stars = repo.stargazerCount || 0;
  const commits = (repo.defaultBranchRef && repo.defaultBranchRef.target && repo.defaultBranchRef.target.history && repo.defaultBranchRef.target.history.totalCount) || 0;
  const desc = repo.description ? ` — ${repo.description}` : '';
  return `- [**${name}**](${url}) — **${commits}** commits • ⭐ ${stars}${desc}`;
}

function updateReadme(reposMd) {
  const readmePath = path.join(process.cwd(), 'README.md');
  let readme = fs.readFileSync(readmePath, 'utf8');
  const startMarker = '<!-- REPO_LIST_START -->';
  const endMarker = '<!-- REPO_LIST_END -->';
  const start = readme.indexOf(startMarker);
  const end = readme.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    console.error('Markers not found or invalid in README.md');
    process.exit(1);
  }
  const before = readme.slice(0, start + startMarker.length);
  const after = readme.slice(end);
  const newContent = `\n\n${reposMd}\n\n`;
  const newReadme = before + newContent + after;
  fs.writeFileSync(readmePath, newReadme, 'utf8');
  console.log('README.md updated with repo list');
}

(async () => {
  try {
    console.log('Fetching repositories...');
    const repos = await fetchAllRepos();

    // Map to objects with commitCount and filter out repos with no default branch
    const mapped = repos.map(r => {
      const commits = (r.defaultBranchRef && r.defaultBranchRef.target && r.defaultBranchRef.target.history && r.defaultBranchRef.target.history.totalCount) || 0;
      return {
        name: r.name,
        url: r.url,
        stars: r.stargazerCount || 0,
        commits,
        description: r.description || '',
        updatedAt: r.updatedAt,
      };
    });

    // Sort by commits desc, then stars desc
    mapped.sort((a, b) => (b.commits - a.commits) || (b.stars - a.stars));

    // Build top 8 list
    const top = mapped.slice(0, 8);
    const md = top.map(formatRepoMd).join('\n');

    updateReadme(md);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
