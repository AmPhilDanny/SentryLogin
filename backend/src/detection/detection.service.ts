import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';

/**
 * Smart CSV detection engine.
 *
 * Given an uploaded CSV (any shape), it figures out:
 *   - whether a header row exists (or the file is headerless, e.g. raw exports)
 *   - what each column contains (username, timestamp, ip, message, host, ...)
 *     based on header aliases AND value patterns (epoch numbers, dates, IPv4, ...)
 *   - the general "kind" of the file (standard login log, SSH syslog, network flow, ...)
 *   - human-readable feedback about what the CSV is, and whether analysis is possible
 *
 * It also exposes `extractLoginRows`, which maps any detected layout into the
 * canonical LoginRow shape the risk pipeline consumes.
 */

export interface FieldMapping {
  /** How the value is resolved: direct column, extracted from a message column, or inferred. */
  source: 'column' | 'message' | 'value' | null;
  /** 0-based column index when `source === 'column'`. */
  index: number | null;
  /** Display name of the column (header name or `Column N`). */
  column: string | null;
  /** Human note (e.g. value normalization applied). */
  note?: string;
}

export type DetectionKind =
  | 'login_standard'
  | 'ssh_syslog'
  | 'network_flow'
  | 'unknown';

export interface DetectionResult {
  hasHeader: boolean;
  columns: string[];
  mapping: {
    username: FieldMapping;
    timestamp: FieldMapping;
    ip: FieldMapping;
    country: FieldMapping;
    city: FieldMapping;
    device: FieldMapping;
    browser: FieldMapping;
    success: FieldMapping;
  };
  kind: DetectionKind;
  kindLabel: string;
  confidence: number;
  feedback: string[];
  canAnalyze: boolean;
  totalRows: number;
}

export interface LoginRow {
  username: string;
  timestamp: string;
  ip: string;
  country: string;
  city: string;
  device: string;
  browser: string;
  success: string;
}

export interface ExtractionResult {
  rows: LoginRow[];
  skipped: { row: number; reason: string }[];
  /** Counts of rows where the success flag was coerced/inferred. */
  successInferred: number;
}

// ---------------------------------------------------------------------------
// Column alias table (header matching)
// ---------------------------------------------------------------------------

interface AliasEntry {
  field: keyof DetectionResult['mapping'] | 'message' | 'host';
  weight: number;
}

const FIELD_ALIASES: Record<string, AliasEntry> = {
  username: { field: 'username', weight: 3 },
  user: { field: 'username', weight: 3 },
  user_name: { field: 'username', weight: 3 },
  username1: { field: 'username', weight: 3 },
  login: { field: 'username', weight: 2 },
  loginname: { field: 'username', weight: 2 },
  account: { field: 'username', weight: 2 },
  accountname: { field: 'username', weight: 2 },
  email: { field: 'username', weight: 2 },
  userid: { field: 'username', weight: 2 },
  user_id: { field: 'username', weight: 2 },
  hostuser: { field: 'username', weight: 2 },
  authuser: { field: 'username', weight: 2 },
  remoteuser: { field: 'username', weight: 2 },
  timestamp: { field: 'timestamp', weight: 3 },
  time: { field: 'timestamp', weight: 3 },
  datetime: { field: 'timestamp', weight: 3 },
  date: { field: 'timestamp', weight: 2 },
  date_time: { field: 'timestamp', weight: 3 },
  eventtime: { field: 'timestamp', weight: 2 },
  event_time: { field: 'timestamp', weight: 2 },
  login_time: { field: 'timestamp', weight: 2 },
  logintime: { field: 'timestamp', weight: 2 },
  ts: { field: 'timestamp', weight: 2 },
  epoch: { field: 'timestamp', weight: 2 },
  epochms: { field: 'timestamp', weight: 2 },
  datefirstseen: { field: 'timestamp', weight: 2 },
  firstseen: { field: 'timestamp', weight: 2 },
  starttime: { field: 'timestamp', weight: 2 },
  ip: { field: 'ip', weight: 3 },
  ip_address: { field: 'ip', weight: 3 },
  ipaddress: { field: 'ip', weight: 3 },
  srcip: { field: 'ip', weight: 2 },
  src_ip: { field: 'ip', weight: 2 },
  sourceip: { field: 'ip', weight: 2 },
  source_ip: { field: 'ip', weight: 2 },
  sourceaddress: { field: 'ip', weight: 2 },
  clientip: { field: 'ip', weight: 2 },
  client_ip: { field: 'ip', weight: 2 },
  remoteip: { field: 'ip', weight: 2 },
  remote_ip: { field: 'ip', weight: 2 },
  remoteaddr: { field: 'ip', weight: 2 },
  sourceaddr: { field: 'ip', weight: 2 },
  srcaddr: { field: 'ip', weight: 2 },
  srcipaddr: { field: 'ip', weight: 2 },
  address: { field: 'ip', weight: 1 },
  country: { field: 'country', weight: 3 },
  countrycode: { field: 'country', weight: 2 },
  country_code: { field: 'country', weight: 2 },
  countryname: { field: 'country', weight: 2 },
  country_name: { field: 'country', weight: 2 },
  city: { field: 'city', weight: 3 },
  cityname: { field: 'city', weight: 2 },
  city_name: { field: 'city', weight: 2 },
  device: { field: 'device', weight: 3 },
  devicetype: { field: 'device', weight: 2 },
  device_type: { field: 'device', weight: 2 },
  devicefamily: { field: 'device', weight: 2 },
  os: { field: 'device', weight: 1 },
  platform: { field: 'device', weight: 1 },
  useragent: { field: 'browser', weight: 2 },
  user_agent: { field: 'browser', weight: 2 },
  agent: { field: 'browser', weight: 2 },
  ua: { field: 'browser', weight: 2 },
  browser: { field: 'browser', weight: 3 },
  browsername: { field: 'browser', weight: 2 },
  success: { field: 'success', weight: 3 },
  successful: { field: 'success', weight: 3 },
  status: { field: 'success', weight: 2 },
  result: { field: 'success', weight: 2 },
  outcome: { field: 'success', weight: 2 },
  authresult: { field: 'success', weight: 2 },
  auth_result: { field: 'success', weight: 2 },
  authenticated: { field: 'success', weight: 2 },
  loginstatus: { field: 'success', weight: 2 },
  login_status: { field: 'success', weight: 2 },
  state: { field: 'success', weight: 1 },
  event: { field: 'success', weight: 1 },
  eventtype: { field: 'success', weight: 1 },
  event_type: { field: 'success', weight: 1 },
  action: { field: 'success', weight: 1 },
  message: { field: 'message', weight: 2 },
  msg: { field: 'message', weight: 2 },
  log: { field: 'message', weight: 1 },
  eventmessage: { field: 'message', weight: 2 },
  event_message: { field: 'message', weight: 2 },
  description: { field: 'message', weight: 1 },
  details: { field: 'message', weight: 1 },
  raw: { field: 'message', weight: 1 },
  syslog: { field: 'message', weight: 2 },
  syslogmessage: { field: 'message', weight: 2 },
  syslog_message: { field: 'message', weight: 2 },
  host: { field: 'host', weight: 2 },
  hostname: { field: 'host', weight: 2 },
  host_name: { field: 'host', weight: 2 },
  server: { field: 'host', weight: 1 },
  machine: { field: 'host', weight: 1 },
  proto: { field: 'message', weight: 1 },
  protocol: { field: 'message', weight: 1 },
};

const NETWORK_FLOW_TOKENS = [
  'proto',
  'protocol',
  'flags',
  'bytes',
  'packets',
  'packet',
  'attackid',
  'attack_id',
  'attack',
  'attacktype',
  'attackdescription',
  'attack_description',
  'flows',
  'dport',
  'sport',
  'srcpt',
  'dstpt',
  'dstip',
  'dst_ip',
  'destip',
  'srcipaddr',
  'dstipaddr',
  'duration',
  'tos',
  'class',
];

const HEADER_LOOSE_TOKENS = [
  'datefirstseen',
  'firstseen',
  'lastseen',
  'starttime',
  'stoptime',
  'duration',
  'proto',
  'protocol',
  'packets',
  'packet',
  'bytes',
  'flows',
  'flags',
  'tos',
  'class',
  'attack',
  'attacktype',
  'attackid',
  'attackdescription',
  'srcpt',
  'dstpt',
  'srcipaddr',
  'dstipaddr',
  'sport',
  'dport',
  'status',
  'event',
  'action',
  'result',
];

const SSH_MESSAGE_PATTERNS = [
  /Accepted\s+(?:password|publickey|keyboard-interactive)\s+for\s+(\S+)\s+from\s+([0-9a-fA-F.:]+)/,
  /Failed\s+password\s+for\s+(\S+)\s+from\s+([0-9a-fA-F.:]+)/,
  /Invalid\s+user\s+(\S+)\s+from\s+([0-9a-fA-F.:]+)/,
  /Disconnected\s+from\s+authenticating\s+user\s+(\S+)\s+([0-9a-fA-F.:]+)/,
  /Connection\s+closed\s+by\s+authenticating\s+user\s+(\S+)\s+([0-9a-fA-F.:]+)/,
  /authentication\s+failure\s+for\s+(\S+)\s+from\s+([0-9a-fA-F.:]+)/,
  /Failed\s+publickey\s+for\s+(\S+)\s+from\s+([0-9a-fA-F.:]+)/,
  /Connection\s+closed\s+by\s+preauth/,
  /preauth/i,
];

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]{2,45}$/;
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,63}$/;
const HOST_RE = /^host[\d_-]*$/i;
const SCI_NUM_RE = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;
const PLAIN_NUM_RE = /^[+-]?\d+(?:\.\d+)?$/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const SYSLOG_DATE_RE = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})/;

const TRUE_VALUES = new Set([
  'true', '1', 'yes', 'y', 'success', 'successful', 'accepted', 'ok', 'okay',
  'pass', 'passed', 'succeeded', 'allow', 'allowed', 'authenticated', 'valid',
]);
const FALSE_VALUES = new Set([
  'false', '0', 'no', 'n', 'fail', 'failed', 'failure', 'denied', 'invalid',
  'disconnect', 'disconnected', 'error', 'refused', 'rejected', 'preauth',
  'unauthenticated', 'closed', 'lockout', 'bad', 'expired',
]);

const FIELD_ORDER: (keyof DetectionResult['mapping'])[] = [
  'username', 'timestamp', 'ip', 'country', 'city', 'device', 'browser', 'success',
];

const FIELD_LABELS: Record<keyof DetectionResult['mapping'], string> = {
  username: 'Username',
  timestamp: 'Timestamp',
  ip: 'IP address',
  country: 'Country',
  city: 'City',
  device: 'Device',
  browser: 'Browser',
  success: 'Success',
};

interface ColumnStats {
  index: number;
  name: string;
  pctIp: number;
  pctDate: number;
  pctEpoch: number;
  pctNumeric: number;
  syslogScore: number;
  userLike: number;
  hostLike: number;
  uniqueCount: number;
  samples: number;
  maxLen: number;
  avgLen: number;
}

@Injectable()
export class DetectionService {
  /**
   * Detect the structure of a CSV and produce a mapping + feedback.
   * Parses only a sample (first ~200 lines) so large files stay cheap.
   */
  detect(buffer: Buffer): DetectionResult {
    const raw = buffer.toString('utf-8').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const totalRows = lines.length - 0; // data rows (header possibly among them)
    const sampleText = lines.slice(0, 201).join('\n');

    let parsed: string[][] = [];
    try {
      parsed = parse(sampleText, {
        columns: false,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
      }) as string[][];
    } catch {
      // Fallback: split naively
      parsed = lines.slice(0, 201).map((l) => l.split(','));
    }

    const firstRow = parsed[0] ?? [];
    const hasHeader = this.detectHeader(parsed);
    const dataStart = hasHeader ? 1 : 0;
    const dataRows = parsed.slice(dataStart, dataStart + 50);
    const columnCount = firstRow.length;

    const columns: string[] = [];
    for (let i = 0; i < columnCount; i++) {
      const name = hasHeader ? (firstRow[i] ?? '').trim() : '';
      columns.push(name || `Column ${i + 1}`);
    }

    const headerAliases = this.matchHeaderAliases(hasHeader ? firstRow : []);
    const headerTokens = hasHeader ? firstRow.map((c) => this.normalizeToken(c)) : [];
    const stats = this.classifyColumns(dataRows, columnCount, hasHeader ? firstRow : []);

    const flowHits = NETWORK_FLOW_TOKENS.filter((t) => headerTokens.includes(t));
    const isNetworkFlow = flowHits.length >= 2;

    const mapping = this.buildMapping(stats, headerAliases, isNetworkFlow);
    const kindInfo = isNetworkFlow
      ? { kind: 'network_flow' as DetectionKind, kindLabel: 'Network flow log (not a login log)' }
      : this.classifyKind(stats, mapping);
    const feedback = this.buildFeedback(
      hasHeader,
      columns,
      mapping,
      kindInfo,
      totalRows,
    );

    const confidence = this.computeConfidence(mapping, kindInfo);

    return {
      hasHeader,
      columns,
      mapping,
      kind: kindInfo.kind,
      kindLabel: kindInfo.kindLabel,
      confidence,
      feedback,
      canAnalyze:
        mapping.username.source !== null &&
        mapping.timestamp.source !== null &&
        mapping.ip.source !== null &&
        kindInfo.kind !== 'network_flow' &&
        kindInfo.kind !== 'unknown',
      totalRows: totalRows - (hasHeader ? 1 : 0),
    };
  }

  /**
   * Map raw rows (arrays) into canonical LoginRow[] using a detection result.
   */
  extractRows(parsed: string[][], detection: DetectionResult): ExtractionResult {
    const rows: LoginRow[] = [];
    const skipped: { row: number; reason: string }[] = [];
    let successInferred = 0;
    const start = detection.hasHeader ? 1 : 0;

    const field = (key: keyof DetectionResult['mapping']) => {
      const m = detection.mapping[key];
      if (m.source === 'column' && m.index !== null) {
        return (row: string[]) => row[m.index!]?.trim() ?? '';
      }
      return null;
    };

    const getUsername = field('username');
    const getTimestamp = field('timestamp');
    const getIp = field('ip');
    const getCountry = field('country');
    const getCity = field('city');
    const getDevice = field('device');
    const getBrowser = field('browser');
    const getSuccess = field('success');
    const successFromMessage =
      detection.mapping.success.source === 'message';

    const msgIdx =
      detection.mapping.success.source === 'message'
        ? detection.mapping.success.index
        : null;

    for (let i = start; i < parsed.length; i++) {
      const row = parsed[i];
      const rowNumber = i + 1;

      let username = getUsername?.(row) ?? '';
      let timestampRaw = getTimestamp?.(row) ?? '';
      let ip = getIp?.(row) ?? '';
      let country = getCountry?.(row) ?? '';
      let city = getCity?.(row) ?? '';
      let device = getDevice?.(row) ?? '';
      let browser = getBrowser?.(row) ?? '';
      let successRaw = getSuccess ? getSuccess(row) : '';

      // Message-based extraction (SSH syslog): pull user/ip/success from the message.
      let message = '';
      if (msgIdx !== null && row[msgIdx]) message = row[msgIdx].trim();
      if (message) {
        const m = this.matchSshMessage(message);
        if (m) {
          if (!username) username = m.user;
          if (!ip) ip = m.ip;
          if (successFromMessage) {
            successRaw = m.success ? 'true' : 'false';
            successInferred += 1;
          }
        }
      }

      if (!username) {
        skipped.push({ row: rowNumber, reason: 'no username found' });
        continue;
      }
      if (!timestampRaw) {
        skipped.push({ row: rowNumber, reason: 'no timestamp found' });
        continue;
      }
      if (!ip) {
        skipped.push({ row: rowNumber, reason: 'no ip address found' });
        continue;
      }

      const timestamp = this.parseTimestamp(timestampRaw);
      if (!timestamp) {
        skipped.push({
          row: rowNumber,
          reason: `unparseable timestamp "${timestampRaw.slice(0, 40)}"`,
        });
        continue;
      }

      const success = this.normalizeSuccess(successRaw, message, successFromMessage);
      if (success === null) {
        skipped.push({
          row: rowNumber,
          reason: `unknown success value "${successRaw.slice(0, 20)}"`,
        });
        continue;
      }
      if (success === 'inferred') successInferred += 1;

      rows.push({
        username: username || 'unknown',
        timestamp,
        ip: ip || '0.0.0.0',
        country: country || '',
        city: city || '',
        device: device || 'Unknown',
        browser: browser || 'Unknown',
        success: success === 'true' ? 'true' : 'false',
      });
    }

    return { rows, skipped, successInferred };
  }

  // -------------------------------------------------------------------------
  // Parsing helpers
  // -------------------------------------------------------------------------

  /** Parse a timestamp from many formats; returns ISO string or null. */
  parseTimestamp(raw: string): string | null {
    const v = raw.trim();
    if (!v) return null;

    // Numeric epoch (incl. Excel scientific notation like 2.02302E+13).
    if (SCI_NUM_RE.test(v) || (PLAIN_NUM_RE.test(v) && v.length >= 9)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      // > 1e12 => milliseconds; otherwise seconds.
      const ms = n > 1e12 ? n : n * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime()) && d.getFullYear() > 1990) {
        return d.toISOString();
      }
      return null;
    }

    // Syslog: "Feb 24 20:40:48 ..." (no year — assume current year).
    const sys = SYSLOG_DATE_RE.exec(v);
    if (sys) {
      const month = MONTHS[sys[1].toLowerCase()];
      if (month !== undefined) {
        const day = Number(sys[2]);
        const hour = Number(sys[3]);
        const minute = Number(sys[4]);
        const second = Number(sys[5]);
        const year = new Date().getFullYear();
        const d = new Date(year, month, day, hour, minute, second);
        if (
          !Number.isNaN(d.getTime()) &&
          d.getFullYear() === year &&
          d.getMonth() === month &&
          d.getDate() === day
        ) {
          return d.toISOString();
        }
      }
      return null;
    }

    // Everything else (ISO, M/d/yyyy H:mm, ...) — let V8 try.
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    return null;
  }

  private matchSshMessage(
    message: string,
  ): { user: string; ip: string; success: boolean } | null {
    for (const re of SSH_MESSAGE_PATTERNS) {
      const m = re.exec(message);
      if (!m) continue;
      if (m[1] && m[2]) {
        return { user: m[1], ip: m[2], success: message.includes('Accepted') };
      }
      if (/preauth/i.test(message) && m[1]) {
        return { user: m[1], ip: '', success: false };
      }
    }
    return null;
  }

  private normalizeSuccess(
    raw: string,
    message: string,
    fromMessage: boolean,
  ): 'true' | 'false' | 'inferred' | null {
    if (raw) {
      const v = raw.toLowerCase();
      if (TRUE_VALUES.has(v)) return 'true';
      if (FALSE_VALUES.has(v)) return 'false';
      if (PLAIN_NUM_RE.test(v)) return Number(v) !== 0 ? 'true' : 'false';
    }
    if (fromMessage || message) {
      if (/Accepted\s+(?:password|publickey)/i.test(message)) return 'true';
      if (
        /Failed|Invalid|Disconnected|preauth|refused|denied|authentication failure/i.test(
          message,
        )
      ) {
        return 'false';
      }
      if (message) return 'inferred';
    }
    if (!raw && !message) return 'inferred';
    return null;
  }

  // -------------------------------------------------------------------------
  // Detection internals
  // -------------------------------------------------------------------------

  private detectHeader(parsed: string[][]): boolean {
    const first = parsed[0] ?? [];
    if (first.length === 0) return false;

    let aliasScore = 0;
    for (const cell of first) {
      const token = this.normalizeToken(cell);
      if (FIELD_ALIASES[token]) aliasScore += FIELD_ALIASES[token].weight;
      if (HEADER_LOOSE_TOKENS.includes(token)) aliasScore += 1;
    }

    // A real header usually has >= 2 recognizable labels.
    if (aliasScore >= 2) return true;

    // If every cell of row 1 is not a number/date/ip and not empty, it's likely a header.
    const dataLike = parsed.slice(1, 6).map((r) => r[0] ?? '');
    const firstLooksLikeData =
      this.isIp(first[0]) ||
      this.parseTimestamp(first[0]) !== null ||
      SCI_NUM_RE.test(first[0]) ||
      (PLAIN_NUM_RE.test(first[0]) && first[0].length >= 9);

    if (firstLooksLikeData) return false;

    // Conservative: don't guess header for headerless value-looking files.
    if (dataLike.length >= 2 && dataLike.every((c) => this.isIp(c) || this.parseTimestamp(c))) {
      return false;
    }
    return false;
  }

  private normalizeToken(cell: string): string {
    return cell
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/^(src|source|remote|client|dst|dest|destination)?(ip|address|addr)$/, 'ip')
      .trim();
  }

  private matchHeaderAliases(
    headerRow: string[],
  ): Partial<Record<keyof DetectionResult['mapping'] | 'message' | 'host', number>> {
    const result: Partial<
      Record<keyof DetectionResult['mapping'] | 'message' | 'host', number>
    > = {};
    headerRow.forEach((cell, i) => {
      const token = this.normalizeToken(cell);
      const entry = FIELD_ALIASES[token];
      if (!entry) return;
      if (result[entry.field] === undefined) result[entry.field] = i;
    });
    return result;
  }

  private isIp(value: string): boolean {
    return IPV4_RE.test(value) || IPV6_RE.test(value);
  }

  private classifyColumns(
    dataRows: string[][],
    columnCount: number,
    headerRow: string[],
  ): ColumnStats[] {
    const stats: ColumnStats[] = [];
    for (let c = 0; c < columnCount; c++) {
      let pctIp = 0, pctDate = 0, pctEpoch = 0, pctNumeric = 0;
      let syslogScore = 0, userLike = 0, hostLike = 0;
      let maxLen = 0, totalLen = 0, samples = 0;
      const seen = new Set<string>();

      for (const row of dataRows) {
        const v = (row[c] ?? '').trim();
        if (!v) continue;
        samples++;
        seen.add(v);
        maxLen = Math.max(maxLen, v.length);
        totalLen += v.length;
        if (this.isIp(v)) pctIp++;
        if (this.parseTimestamp(v) !== null) pctDate++;
        if (SCI_NUM_RE.test(v)) pctEpoch++;
        if (PLAIN_NUM_RE.test(v) && v.length >= 9) pctEpoch++;
        if (PLAIN_NUM_RE.test(v)) pctNumeric++;
        if (/sshd|preauth|Accepted|Failed|Invalid|Disconnected|authenticating/i.test(v)) {
          syslogScore++;
        }
        if (USERNAME_RE.test(v) && !HOST_RE.test(v) && !this.isIp(v)) userLike++;
        if (HOST_RE.test(v)) hostLike++;
      }

      const denom = Math.max(samples, 1);
      stats.push({
        index: c,
        name: headerRow[c] ? headerRow[c].trim() : `Column ${c + 1}`,
        pctIp: pctIp / denom,
        pctDate: pctDate / denom,
        pctEpoch: pctEpoch / denom,
        pctNumeric: pctNumeric / denom,
        syslogScore: syslogScore / denom,
        userLike: userLike / denom,
        hostLike: hostLike / denom,
        uniqueCount: seen.size,
        samples,
        maxLen,
        avgLen: samples > 0 ? totalLen / samples : 0,
      });
    }
    return stats;
  }

  private buildMapping(
    stats: ColumnStats[],
    aliases: Partial<Record<keyof DetectionResult['mapping'] | 'message' | 'host', number>>,
    skipValueClassification = false,
  ): DetectionResult['mapping'] {
    const empty = (): FieldMapping => ({ source: null, index: null, column: null });
    const mapping: DetectionResult['mapping'] = {
      username: empty(),
      timestamp: empty(),
      ip: empty(),
      country: empty(),
      city: empty(),
      device: empty(),
      browser: empty(),
      success: empty(),
    };

    const byIndex = new Map(stats.map((s) => [s.index, s]));
    const taken = new Set<number>();
    const fromAlias = (key: keyof DetectionResult['mapping'] | 'message' | 'host') => {
      const idx = aliases[key];
      if (idx === undefined || idx === null) return;
      if (key in mapping) {
        const field = key as keyof DetectionResult['mapping'];
        const st = byIndex.get(idx);
        if (st && !taken.has(idx)) {
          mapping[field] = {
            source: 'column',
            index: idx,
            column: st.name,
          };
          taken.add(idx);
        }
      }
    };

    // 1. Header aliases (when present).
    for (const field of FIELD_ORDER) fromAlias(field);
    if (!mapping.username.source) fromAlias('username');
    if (!mapping.success.source) fromAlias('success');

    if (skipValueClassification) return mapping;

    // 2. Value-pattern classification (works for headerless files too).
    const pick = (field: keyof DetectionResult['mapping'], predicate: (s: ColumnStats) => number) => {
      if (mapping[field].source) return;
      const candidates = stats
        .filter((s) => !taken.has(s.index) && predicate(s) > 0.8)
        .sort((a, b) => predicate(b) - predicate(a));
      const best = candidates[0];
      if (best) {
        mapping[field] = { source: 'column', index: best.index, column: best.name };
        taken.add(best.index);
      }
    };

    pick('timestamp', (s) => s.pctEpoch);
    pick('timestamp', (s) => s.pctDate);
    pick('ip', (s) => s.pctIp);
    pick('username', (s) => s.userLike);

    // 3. Message column: highest syslog score OR longest average text.
    if (!mapping.success.source) {
      const msgCandidates = stats
        .filter((s) => !taken.has(s.index))
        .sort((a, b) => b.syslogScore - a.syslogScore || b.avgLen - a.avgLen);
      const msg = msgCandidates[0];
      if (msg && (msg.syslogScore > 0.5 || (msg.avgLen > 40 && msg.maxLen > 80))) {
        mapping.success = { source: 'message', index: msg.index, column: msg.name };
        taken.add(msg.index);
        if (!mapping.username.source) {
          mapping.username = { source: 'message', index: msg.index, column: msg.name };
        }
        if (!mapping.ip.source) {
          mapping.ip = { source: 'message', index: msg.index, column: msg.name };
        }
      }
    }

    // 4. Fill notes for value-normalized fields.
    if (mapping.success.source === 'column') {
      mapping.success.note = 'values normalized to true/false';
    }
    if (mapping.timestamp.source === 'column') {
      mapping.timestamp.note = 'format auto-detected (ISO / datetime / epoch)';
    }
    if (!mapping.username.source) {
      mapping.username.note = 'will use "unknown"';
    }

    return mapping;
  }

  private classifyKind(
    stats: ColumnStats[],
    mapping: DetectionResult['mapping'],
  ): { kind: DetectionKind; kindLabel: string } {
    if (stats.some((s) => s.syslogScore > 0.5)) {
      return { kind: 'ssh_syslog', kindLabel: 'SSH/syslog auth log' };
    }
    if (stats.length > 0 && stats.some((s) => s.name !== `Column ${s.index + 1}`)) {
      const mappedCount = FIELD_ORDER.filter((f) => mapping[f].source === 'column').length;
      if (mappedCount >= 5) {
        return { kind: 'login_standard', kindLabel: 'Standard login log' };
      }
      if (mappedCount >= 3) {
        return { kind: 'login_standard', kindLabel: 'Login log (partially mapped)' };
      }
    }
    if (
      mapping.timestamp.source === 'column' &&
      mapping.ip.source === 'column' &&
      mapping.username.source === 'column'
    ) {
      return { kind: 'ssh_syslog', kindLabel: 'Login log (headerless)' };
    }
    return { kind: 'unknown', kindLabel: 'Unrecognized format' };
  }

  private computeConfidence(
    mapping: DetectionResult['mapping'],
    kindInfo: { kind: DetectionKind },
  ): number {
    if (kindInfo.kind === 'unknown') return 20;
    let score = 30;
    const required: (keyof DetectionResult['mapping'])[] = [
      'username', 'timestamp', 'ip',
    ];
    const optional: (keyof DetectionResult['mapping'])[] = [
      'success', 'country', 'city', 'device', 'browser',
    ];
    for (const f of required) if (mapping[f].source) score += 20;
    for (const f of optional) if (mapping[f].source) score += 4;
    return Math.min(score, 100);
  }

  private buildFeedback(
    hasHeader: boolean,
    columns: string[],
    mapping: DetectionResult['mapping'],
    kindInfo: { kind: DetectionKind; kindLabel: string },
    totalRows: number,
  ): string[] {
    const lines: string[] = [];
    lines.push(
      `${kindInfo.kindLabel} detected (${totalRows} rows, ${columns.length} columns${
        hasHeader ? '' : ', no header row'
      }).`,
    );

    const described = FIELD_ORDER.filter((f) => mapping[f].source).map((f) => {
      const m = mapping[f];
      if (m.source === 'message') return `${FIELD_LABELS[f]} ← parsed from "${m.column}"`;
      if (m.source === 'column') return `${FIELD_LABELS[f]} ← "${m.column}"`;
      return FIELD_LABELS[f];
    });
    if (described.length > 0) {
      lines.push(`Mapped: ${described.join(' · ')}.`);
    }

    if (mapping.success.source === 'message') {
      lines.push(
        'Login success is inferred from the log message (Accepted = success; Failed/Invalid/Disconnected = failure).',
      );
    }
    if (!mapping.country.source) {
      lines.push('No country/city column — geo features will be skipped for this dataset.');
    }
    if (!mapping.device.source && !mapping.browser.source) {
      lines.push('No device/browser column — device-change features will be skipped.');
    }
    if (kindInfo.kind === 'network_flow') {
      lines.push(
        'This appears to be a network traffic/flow log (proto, packets, bytes, ...), not a login audit log — analysis is not applicable.',
      );
    }
    if (kindInfo.kind === 'unknown') {
      lines.push(
        'Could not recognize login-related columns. Analysis will be blocked until the format is understood.',
      );
    }
    return lines;
  }
}
