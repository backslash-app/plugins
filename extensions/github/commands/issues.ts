import { action, type Context, copy, detail, Icons, list, meta, open } from "@backslash/api";
import { ago, colorOf, graphql, needToken } from "../api.ts";

interface Issue {
  id: string;
  number: number;
  title: string;
  url: string;
  body?: string | null;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  author?: { login: string; avatarUrl?: string } | null;
  repository: { nameWithOwner: string };
  labels?: { nodes: { name: string; color: string }[] };
  assignees?: { nodes: { login: string; avatarUrl?: string }[] };
  comments?: { totalCount: number };
  milestone?: { title: string } | null;
}

const FIELDS = `
  ... on Issue {
    id number title url body state createdAt updatedAt
    author { login avatarUrl }
    repository { nameWithOwner }
    labels(first: 6) { nodes { name color } }
    assignees(first: 4) { nodes { login avatarUrl } }
    comments { totalCount }
    milestone { title }
  }
`;

const QUERIES: Record<string, string> = {
  assigned: "is:issue is:open archived:false assignee:@me",
  created: "is:issue is:open archived:false author:@me",
  mentioned: "is:issue is:open archived:false mentions:@me",
};

function metadata(issue: Issue) {
  const labels = issue.labels?.nodes ?? [];
  return [
    meta.text("Status", issue.state === "OPEN" ? "Open" : "Closed", {
      icon: issue.state === "OPEN" ? Icons.issue : Icons.issueClosed,
      color: issue.state === "OPEN" ? "green" : "purple",
    }),
    meta.person("Author", issue.author?.login ?? "ghost", issue.author?.avatarUrl),
    ...(issue.assignees?.nodes.length ? [meta.tags("Assignees", issue.assignees.nodes.map((a) => a.login))] : []),
    ...(labels.length ? [meta.tags("Labels", labels.map((l) => ({ text: l.name, color: colorOf(l.color) })))] : []),
    ...(issue.milestone ? [meta.text("Milestone", issue.milestone.title, { icon: Icons.flag })] : []),
    meta.text("Comments", issue.comments?.totalCount ?? 0, { icon: Icons.comment }),
    meta.separator(),
    meta.text("Repository", issue.repository.nameWithOwner, { icon: Icons.repository }),
    meta.text("Opened", ago(issue.createdAt)),
    meta.text("Updated", ago(issue.updatedAt)),
  ];
}

export default (_ctx: Context) =>
  list({
    placeholder: "Filter issues by title, repository, label…",
    filter: {
      options: [
        { value: "assigned", title: "Assigned to me" },
        { value: "created", title: "Opened by me" },
        { value: "mentioned", title: "Mentioning me" },
      ],
    },
    empty: { title: "No open issues here", icon: "bs-issue-closed" },
    status: (items) => `${items.length} issue${items.length === 1 ? "" : "s"}`,
    async items({ preferences, signal, filter }) {
      const t = await needToken(preferences);
      const data = await graphql<{ search: { nodes: Issue[] } }>(
        t,
        `query($q: String!) { search(query: $q, type: ISSUE, first: 50) { nodes { ${FIELDS} } } }`,
        { q: `${QUERIES[filter ?? "assigned"] ?? QUERIES.assigned} sort:updated-desc` },
        signal,
      );
      return data.search.nodes.filter((n) => n && n.number).map((issue) => {
        const labels = issue.labels?.nodes ?? [];
        const body = issue.body?.trim();
        return {
          id: issue.id,
          title: issue.title,
          subtitle: `#${issue.number}`,
          icon: { source: Icons.issue, tint: "green" as const },
          section: issue.repository.nameWithOwner,
          keywords: [issue.repository.nameWithOwner, String(issue.number), ...labels.map((l) => l.name)],
          accessories: [
            ...labels.slice(0, 2).map((l) => ({ tag: l.name, color: colorOf(l.color) })),
            ...(issue.comments?.totalCount ? [{ text: String(issue.comments.totalCount), icon: Icons.comment }] : []),
            ...(issue.author
              ? [{ avatar: issue.author.avatarUrl ?? issue.author.login, tooltip: issue.author.login }]
              : []),
            { text: ago(issue.updatedAt) },
          ],
          detail: {
            markdown: body ? (body.length > 400 ? `${body.slice(0, 400)}…` : body) : undefined,
            metadata: metadata(issue),
          },
          actions: [
            open(issue.url, "Open in Browser"),
            action("Show Details", () =>
              detail({
                title: `#${issue.number}`,
                markdown: `# ${issue.title}\n\n${body || "_No description._"}`,
                metadata: metadata(issue),
                status: `${issue.repository.nameWithOwner} #${issue.number}`,
                actions: [open(issue.url, "Open in Browser"), copy(issue.url, "Copy URL")],
              }), { icon: Icons.info }),
            copy(issue.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
            copy(
              `[${issue.repository.nameWithOwner}#${issue.number}: ${issue.title}](${issue.url})`,
              "Copy as Markdown Link",
              { section: "Copy" },
            ),
          ],
        };
      });
    },
  });
