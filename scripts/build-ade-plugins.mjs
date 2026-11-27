import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import {
  INKADE_TOOL_DEFINITIONS,
  SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME,
} from "../packages/core/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const TEMPLATE_DIR = join(REPO_ROOT, "packaging", "ade-plugins");
const DIST_ROOT = join(REPO_ROOT, "dist", "ade-plugins");

function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeText(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf8");
}

function buildMcpConfig(harness, binaryRef) {
  if (harness.mcpFormat === "opencode") {
    return {
      $schema: "https://opencode.ai/config.json",
      mcp: {
        inkade: {
          type: "local",
          command: ["node", binaryRef, "mcp", "--harness", harness.profileName],
        },
      },
    };
  }

  return {
    mcpServers: {
      inkade: {
        command: "node",
        args: [binaryRef, "mcp", "--harness", harness.profileName],
      },
    },
  };
}

function buildHooksConfig(harness, binaryRef) {
  const hookCommand = (eventName) =>
    `node "${binaryRef}" hook ${eventName} --harness ${harness.profileName}`;

  if (harness.hooksFormat === "cursor") {
    const hooks = {};
    for (const eventName of harness.hookEvents) {
      hooks[eventName] = [{ command: hookCommand(eventName) }];
    }
    return {
      version: 1,
      hooks,
    };
  }

  if (harness.hooksFormat === "copilot" || harness.hooksFormat === "antigravity") {
    const hooks = {};
    for (const eventName of harness.hookEvents) {
      hooks[eventName] = [{ type: "command", command: hookCommand(eventName) }];
    }
    return { hooks };
  }

  // Claude Code / Codex / OpenCode standard matcher hook structure
  const hooks = {};
  for (const eventName of harness.hookEvents) {
    hooks[eventName] = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: hookCommand(eventName),
          },
        ],
      },
    ];
  }
  return { hooks };
}

function buildMonitorsConfig(harness, binaryRef) {
  return {
    monitors: [
      {
        name: "inkade-wake-bus",
        command: "node",
        args: [binaryRef, "watch", "--harness", harness.profileName],
        description:
          "Subscribe to Inkade SSE wake events and deliver owner feedback to active sessions.",
      },
    ],
  };
}

function buildPluginManifest(manifest, harness) {
  const profile = SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME[harness.profileName];
  return {
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    description: harness.description,
    harness: harness.profileName,
    wakeLevel: profile?.level ?? "L2",
    wakesIdle: profile?.wakesIdle ?? false,
    ...(profile?.hookDialect ? { hookDialect: profile.hookDialect } : {}),
    mcpServers: `./${harness.mcpConfigPath}`,
    ...(harness.hooksConfigPath ? { hooks: `./${harness.hooksConfigPath}` } : {}),
    ...(harness.monitorsConfigPath ? { monitors: `./${harness.monitorsConfigPath}` } : {}),
    ...(harness.extensionPath ? { entrypoint: `./${harness.extensionPath}` } : {}),
    skills: ["./skills/inkade"],
  };
}

function buildPiExtensionSource(manifest, harness) {
  return `export const inkadePluginMetadata = ${JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      harness: harness.profileName,
      mcpCommand: ["node", `../${manifest.binaryTargetRelPath}`, "mcp", "--harness", harness.profileName],
      doctorCommand: [
        "node",
        `../${manifest.binaryTargetRelPath}`,
        "doctor",
        "--harness",
        harness.profileName,
        "--json",
      ],
    },
    null,
    2,
  )};

export default function registerInkadeExtension() {
  return inkadePluginMetadata;
}
`;
}

function renderSkillMarkdown(template, harness) {
  const profile = SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME[harness.profileName];
  const toolLines = INKADE_TOOL_DEFINITIONS.map(
    (tool) => `- \`${tool.mcpName}\` (\`${tool.requiredPermission}\`, \`${tool.actionCategory}\`): ${tool.description}`,
  ).join("\n");

  return template
    .replaceAll("{{HARNESS_NAME}}", harness.profileName)
    .replaceAll("{{HARNESS_TITLE}}", harness.displayName)
    .replaceAll("{{WAKE_LEVEL}}", profile?.level ?? "L2")
    .replaceAll("{{TOOL_COUNT}}", String(INKADE_TOOL_DEFINITIONS.length))
    .replaceAll("{{TOOL_CATALOG_LIST}}", toolLines)
    .replaceAll(
      "{{HOOK_EVENTS}}",
      harness.hookEvents.length > 0 ? harness.hookEvents.join(", ") : "MCP polling only",
    );
}

function buildMarketplaceJson(manifest, marketplaceEntry, harnessById) {
  const plugins = marketplaceEntry.pluginIds.map((id) => {
    const h = harnessById.get(id);
    return {
      name: `inkade-${h.id}`,
      displayName: `Inkade for ${h.displayName}`,
      version: manifest.version,
      description: h.description,
      source: `./${h.id}`,
      manifest: `./${h.id}/${h.manifestPath}`,
      harness: h.profileName,
    };
  });

  return {
    name: "inkade-ade-marketplace",
    version: manifest.version,
    license: manifest.license,
    owner: {
      name: "Inkade",
      url: manifest.repository,
    },
    plugins,
  };
}

// --- Zero-dependency deterministic ZIP writer using node:zlib ---

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFilesRecursive(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out.sort();
}

function createZipBuffer(sourceDir, skipRelPaths = new Set()) {
  const files = collectFilesRecursive(sourceDir);
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const filePath of files) {
    const relPath = relative(sourceDir, filePath).replaceAll("\\", "/");
    if (skipRelPaths.has(relPath)) continue;

    const rawData = readFileSync(filePath);
    const compressed = deflateRawSync(rawData);
    const useDeflate = compressed.length < rawData.length;
    const payload = useDeflate ? compressed : rawData;
    const method = useDeflate ? 8 : 0;
    const fileCrc = crc32(rawData);
    const nameBytes = Buffer.from(relPath, "utf8");
    const st = statSync(filePath);
    const extAttr = (st.mode & 0o111) !== 0 ? (0o100755 << 16) >>> 0 : (0o100644 << 16) >>> 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(fileCrc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBytes, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4); // Unix creator
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(fileCrc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(extAttr, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + payload.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralParts.length / 2, 8);
  eocd.writeUInt16LE(centralParts.length / 2, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

export function buildAdePlugins() {
  const manifestPath = join(TEMPLATE_DIR, "manifest.json");
  const skillTemplatePath = join(TEMPLATE_DIR, "SKILL.template.md");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const skillTemplate = readFileSync(skillTemplatePath, "utf8");

  // Step 1: Build @inkade/cli into packages/cli/dist/inkade-bridge.mjs
  execFileSync("bun", ["run", "--filter", "@inkade/cli", "build"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: false,
  });

  const binarySourcePath = resolve(REPO_ROOT, manifest.binarySource);
  if (!existsSync(binarySourcePath)) {
    throw new Error(`Missing built CLI bridge binary at ${binarySourcePath}`);
  }

  // Step 2: Clean and rebuild dist/ade-plugins/
  rmSync(DIST_ROOT, { recursive: true, force: true });
  mkdirSync(DIST_ROOT, { recursive: true });

  const harnessById = new Map();
  for (const harness of manifest.harnesses) {
    harnessById.set(harness.id, harness);
    if (!SHIPPED_HARNESS_WAKE_PROFILES_BY_NAME[harness.profileName]) {
      throw new Error(`Manifest harness "${harness.profileName}" not found in SHIPPED_HARNESS_WAKE_PROFILES`);
    }

    const bundleDir = join(DIST_ROOT, harness.id);
    const binaryRef = `${harness.commandPrefix}/${manifest.binaryTargetRelPath}`;
    const binaryDestPath = join(bundleDir, manifest.binaryTargetRelPath);
    mkdirSync(dirname(binaryDestPath), { recursive: true });
    copyFileSync(binarySourcePath, binaryDestPath);
    if (process.platform !== "win32") {
      chmodSync(binaryDestPath, 0o755);
    }

    // Plugin manifest
    writeJson(join(bundleDir, harness.manifestPath), buildPluginManifest(manifest, harness));

    // MCP configuration
    writeJson(join(bundleDir, harness.mcpConfigPath), buildMcpConfig(harness, binaryRef));

    // Hooks configuration (when supported by harness)
    if (harness.hooksConfigPath) {
      writeJson(join(bundleDir, harness.hooksConfigPath), buildHooksConfig(harness, binaryRef));
    }

    // Monitors configuration (Claude Code)
    if (harness.monitorsConfigPath) {
      writeJson(join(bundleDir, harness.monitorsConfigPath), buildMonitorsConfig(harness, binaryRef));
    }

    // Extension script (Pi)
    if (harness.extensionPath) {
      writeText(join(bundleDir, harness.extensionPath), buildPiExtensionSource(manifest, harness));
    }

    // Rendered SKILL.md
    writeText(
      join(bundleDir, "skills", "inkade", "SKILL.md"),
      renderSkillMarkdown(skillTemplate, harness),
    );
  }

  // Step 3: Root-level Marketplace indexes
  for (const mp of manifest.marketplaces) {
    writeJson(join(DIST_ROOT, mp.path), buildMarketplaceJson(manifest, mp, harnessById));
  }

  // Step 4: Distributable archive
  const zipPath = join(DIST_ROOT, "inkade-ade-plugins.zip");
  const zipBuf = createZipBuffer(DIST_ROOT, new Set(["inkade-ade-plugins.zip"]));
  writeFileSync(zipPath, zipBuf);

  return {
    distRoot: DIST_ROOT,
    zipPath,
    harnesses: manifest.harnesses.map((h) => h.id),
    marketplaces: manifest.marketplaces.map((m) => m.path),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = buildAdePlugins();
  console.log(
    `Built ${result.harnesses.length} ADE plugin bundles (${result.harnesses.join(", ")}) -> ${result.distRoot}`,
  );
}
