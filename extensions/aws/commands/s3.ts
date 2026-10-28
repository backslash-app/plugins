import {
  action,
  clipboard,
  close,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
} from "@backslash/api";
import {
  age,
  type Bucket,
  bytes,
  formatDate,
  parseBuckets,
  parseObjects,
  relativeKey,
  s3ConsoleUrl,
  type S3Entry,
} from "../lib.ts";
import {
  aws,
  awsMissing,
  errorItem,
  isMissing,
  noProfiles,
  type Prefs,
  profileActions,
  type Session,
  session,
  showProfile,
} from "../aws.ts";

const MAX_KEYS = 300;

/** One level of a bucket: its "folders" (common prefixes) and objects. */
function browse(bucket: Bucket, prefix: string, s: Session, prefs: Prefs): ListSpec {
  let truncated = false;
  return list({
    title: `s3://${bucket.name}/${prefix}`,
    placeholder: `Filter s3://${bucket.name}/${prefix}…`,
    empty: { title: "Empty", description: "No objects under this prefix", icon: Icons.folder },
    status: (items) => `${items.length}${truncated ? `+` : ""} entries · s3://${bucket.name}/${prefix}`,
    async items({ signal }) {
      let entries: S3Entry[];
      try {
        const out = await aws([
          "s3api",
          "list-objects-v2",
          "--bucket",
          bucket.name,
          "--prefix",
          prefix,
          "--delimiter",
          "/",
          "--max-items",
          String(MAX_KEYS),
        ], { profile: s.profile, region: bucket.region, signal });
        entries = parseObjects(out);
        truncated = /"NextToken"/.test(out);
      } catch (err) {
        return [errorItem(err, s, prefs, bucket.region)];
      }
      return entries.map((e) => entryItem(bucket, prefix, e, s, prefs));
    },
  });
}

function entryItem(bucket: Bucket, prefix: string, e: S3Entry, s: Session, prefs: Prefs): Item {
  const uri = `s3://${bucket.name}/${e.key}`;
  const name = relativeKey(e.key, prefix);
  if (e.folder) {
    return {
      id: e.key,
      title: name,
      icon: { source: Icons.folder, tint: "blue" },
      section: "Folders",
      actions: [
        action("Open Folder", () => browse(bucket, e.key, s, prefs), { icon: Icons.folder }),
        open(s3ConsoleUrl(bucket.name, e.key, bucket.region), "Open in AWS Console", {
          icon: Icons.globe,
          shortcut: "<Ctrl>o",
        }),
        copy(uri, "Copy S3 URI", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ],
    };
  }
  return {
    id: e.key,
    title: name,
    icon: { source: Icons.file, tint: "gray" },
    section: "Objects",
    accessories: [
      ...(e.size !== undefined ? [{ text: bytes(e.size), tooltip: "Size" }] : []),
      ...(e.modified ? [{ text: age(e.modified), tooltip: formatDate(e.modified) }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Key", e.key, { icon: Icons.file }),
        ...(e.size !== undefined ? [meta.text("Size", bytes(e.size))] : []),
        ...(e.modified ? [meta.text("Modified", formatDate(e.modified), { icon: Icons.calendar })] : []),
        ...(e.storageClass ? [meta.tags("Storage class", [e.storageClass])] : []),
        meta.text("Bucket", bucket.name, { icon: Icons.archive }),
      ],
    },
    actions: [
      copy(uri, "Copy S3 URI", { shortcut: "<Ctrl><Shift>c" }),
      action("Copy Pre-signed URL (1 hour)", async () => {
        const url = await aws(["s3", "presign", uri, "--expires-in", "3600"], {
          profile: s.profile,
          region: bucket.region,
          json: false,
        });
        // Anyone holding it can download the object: keep it out of clipboard histories.
        await clipboard.write(url, { concealed: true });
        return close("Pre-signed URL copied, valid 1 hour");
      }, { icon: Icons.link, shortcut: "<Ctrl>l" }),
      open(s3ConsoleUrl(bucket.name, prefix, bucket.region), "Open Folder in AWS Console", {
        icon: Icons.globe,
        shortcut: "<Ctrl>o",
      }),
      copy(e.key, "Copy Key", { section: "Copy" }),
      copy(`arn:aws:s3:::${bucket.name}/${e.key}`, "Copy ARN", { section: "Copy" }),
    ],
  };
}

function bucketItem(b: Bucket, s: Session, prefs: Prefs): Item {
  return {
    id: b.name,
    title: b.name,
    icon: { source: Icons.archive, tint: "green" },
    section: b.region ?? "Buckets",
    keywords: [b.region ?? ""],
    accessories: [
      ...(b.region ? [{ icon: Icons.globe, text: b.region, tooltip: "Region" }] : []),
      ...(b.created ? [{ text: age(b.created), tooltip: `Created ${formatDate(b.created)}` }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Bucket", b.name, { icon: Icons.archive }),
        ...(b.region ? [meta.text("Region", b.region, { icon: Icons.globe })] : []),
        ...(b.created ? [meta.text("Created", formatDate(b.created), { icon: Icons.calendar })] : []),
        meta.text("Profile", s.profile ?? "default", { icon: Icons.person }),
      ],
    },
    actions: [
      open(s3ConsoleUrl(b.name, "", b.region), "Open in AWS Console", { icon: Icons.globe }),
      action("Browse Objects", () => browse(b, "", s, prefs), { icon: Icons.folder, shortcut: "<Ctrl>b" }),
      copy(`s3://${b.name}`, "Copy S3 URI", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(b.name, "Copy Bucket Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`arn:aws:s3:::${b.name}`, "Copy ARN", { section: "Copy" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...profileActions(prefs),
    ],
  };
}

export default list({
  placeholder: "Filter S3 buckets…",
  empty: { title: "No buckets", description: "This account has no S3 bucket", icon: Icons.archive },
  status: (items) => {
    const n = items.filter((i) => !i.id?.startsWith("error") && i.id !== "missing").length;
    return n ? `${n} bucket${n === 1 ? "" : "s"}` : "";
  },
  async items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const s = await session(prefs);
    try {
      // list-buckets is global; the region only picks the endpoint.
      const buckets = parseBuckets(
        await aws(["s3api", "list-buckets"], { profile: s.profile, region: s.regions[0], signal }),
      );
      await showProfile(s, `${buckets.length} buckets`);
      return buckets.map((b) => bucketItem(b, s, prefs));
    } catch (err) {
      if (isMissing(err)) return [await awsMissing()];
      if (!s.profiles.length) return [noProfiles(prefs)];
      return [errorItem(err, s, prefs)];
    }
  },
});
