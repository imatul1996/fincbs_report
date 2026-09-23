// ---- Configuration -------------------------------------------------------
const CONFIG = {
	// Backend endpoint that runs the SQL and returns one batch of CSV rows per call.
	endpoint: "/api/method/custom_report.www.double_leg_transaction.download_transactions",
	// Rows fetched per request. A 9-10 lakh row report is downloaded in batches of this size.
	batchSize: 50000,
	// How many times a failed batch is retried before the download stops.
	retries: 2,
	// true = fake 9,50,000-row download for trying the screen without a backend.
	demo: false,
};
// --------------------------------------------------------------------------

const form = document.getElementById("reportForm");
const btn = document.getElementById("downloadBtn");
const statusBox = document.getElementById("status");
const progressBox = document.getElementById("progress");
const progressLabel = document.getElementById("progressLabel");
const progressDetail = document.getElementById("progressDetail");
const timerEl = document.getElementById("timer");
const bar = document.getElementById("bar");
const barFill = document.getElementById("barFill");

const fields = {
	account: {
		input: document.getElementById("accountValue"),
		err: document.getElementById("accountErr"),
	},
	start: {
		input: document.getElementById("startDate"),
		err: document.getElementById("startErr"),
	},
	end: { input: document.getElementById("endDate"), err: document.getElementById("endErr") },
};

const demoBanner = document.getElementById("demoBanner");
if (demoBanner) demoBanner.hidden = !CONFIG.demo;

// What each "Search by" option means. The value is sent to the backend as account_type.
const SEARCH_TYPES = {
	bacid: {
		label: "BACID",
		placeholder: "Enter BACID",
		hint: "Only transactions for accounts with this BACID are included.",
	},
	foracid: {
		label: "FORACID",
		placeholder: "Enter FORACID",
		hint: "Only transactions for this account number (FORACID) are included.",
	},
	gl_sub_head_code: {
		label: "GL sub head code",
		placeholder: "Enter GL sub head code",
		hint: "Only transactions for accounts under this GL sub head code are included.",
	},
};
const accountLabel = document.getElementById("accountLabel");
const accountHint = document.getElementById("accountHint");

function currentType() {
	return form.elements["account_type"].value;
}

function applySearchType() {
	const t = SEARCH_TYPES[currentType()];
	accountLabel.textContent = t.label;
	fields.account.input.placeholder = t.placeholder;
	accountHint.textContent = t.hint;
	setError("account", "");
}
if (form) {
	form.querySelectorAll('input[name="account_type"]').forEach((r) =>
		r.addEventListener("change", applySearchType),
	);
}

const today = new Date();
const todayStr = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
	.toISOString()
	.slice(0, 10);
fields.start.input.max = todayStr;
fields.end.input.max = todayStr;

// ---- Helpers -------------------------------------------------------------
function setError(key, message) {
	const f = fields[key];
	f.err.textContent = message || "";
	if (message) f.input.setAttribute("aria-invalid", "true");
	else f.input.removeAttribute("aria-invalid");
}

function showStatus(type, message) {
	statusBox.className = "status " + type;
	statusBox.textContent = message;
	statusBox.hidden = false;
}

function fmtTime(ms) {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
}

function fmtBytes(n) {
	if (n < 1024) return n + " B";
	if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
	return (n / (1024 * 1024)).toFixed(1) + " MB";
}

// Timer
let timerId = null;
let startedAt = 0;
function startTimer() {
	startedAt = performance.now();
	timerEl.textContent = "00:00";
	clearInterval(timerId);
	timerId = setInterval(() => {
		timerEl.textContent = fmtTime(performance.now() - startedAt);
	}, 250);
}
function stopTimer() {
	clearInterval(timerId);
	const elapsed = performance.now() - startedAt;
	timerEl.textContent = fmtTime(elapsed);
	return elapsed;
}

// Progress bar: pass a number 0-100, or null for "working, size unknown"
function setProgress(pct) {
	if (pct == null) {
		bar.classList.add("indeterminate");
		bar.removeAttribute("aria-valuenow");
		barFill.style.width = "";
	} else {
		bar.classList.remove("indeterminate");
		bar.setAttribute("aria-valuenow", Math.round(pct));
		barFill.style.width = pct + "%";
	}
}

function saveBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function validate() {
	const account = fields.account.input.value.trim();
	const start = fields.start.input.value;
	const end = fields.end.input.value;

	setError("account", !account ? "Enter the " + SEARCH_TYPES[currentType()].label + "." : "");
	setError("start", !start ? "Choose a start date." : "");
	setError("end", !end ? "Choose an end date." : "");
	if (start && end && start > end)
		setError("end", "End date must be on or after the start date.");

	for (const key of ["account", "start", "end"]) {
		if (fields[key].input.getAttribute("aria-invalid") === "true") {
			fields[key].input.focus();
			return null;
		}
	}
	return {
		account_type: currentType(),
		account_value: account,
		start_date: start,
		end_date: end,
	};
}

// ---- Batch download helpers ---------------------------------------------
const nf = new Intl.NumberFormat("en-IN"); // 9,50,000 style grouping
const CSV_TYPE = "text/csv;charset=utf-8";

// Make the header row (first line) CAPITAL and make sure the file starts with one UTF-8 BOM.
function upperCaseHeader(text) {
	text = text.replace(/^\ufeff/, "");
	const i = text.search(/\r?\n/);
	const head = i === -1 ? text : text.slice(0, i);
	const rest = i === -1 ? "" : text.slice(i);
	return "\ufeff" + head.toUpperCase() + rest;
}

// Update the bar, label and detail line after each finished batch.
function reportBatch(batchNo, totalBatches, rowsDone, total, durations) {
	setProgress(Math.min(99, (rowsDone / total) * 100));

	// Estimate time left from the average batch time. The first batch also includes
	// query time, so it is left out once we have more than one batch to average.
	const sample = durations.length > 1 ? durations.slice(1) : durations;
	const avg = sample.reduce((a, b) => a + b, 0) / sample.length;
	const left = avg * (totalBatches - batchNo);

	let text =
		"Batch " +
		batchNo +
		" of " +
		totalBatches +
		" · " +
		nf.format(rowsDone) +
		" of " +
		nf.format(total) +
		" rows";
	if (batchNo < totalBatches) text += " · about " + fmtTime(left) + " left";
	progressDetail.textContent = text;
}

// One request for one batch, with retries for network and server (5xx) errors.
async function fetchBatch(params, offset) {
	for (let attempt = 0; ; attempt++) {
		try {
			const body = new URLSearchParams({ ...params, offset, limit: CONFIG.batchSize });
			const res = await fetch(CONFIG.endpoint, {
				method: "POST",
				body: body,
			});
			const json = await res.json();
			if (json.message && json.message.total !== undefined) {
				return json.message;
			}
			if (json._server_messages) {
				let msg = "The report could not be generated. Try again in a moment.";
				try { const parsed = JSON.parse(JSON.parse(json._server_messages)[0]); msg = parsed.message || msg; } catch(_) {}
				const err = new Error(msg);
				err.fatal = true;
				throw err;
			}
			const err = new Error("The report could not be generated. Try again in a moment.");
			err.fatal = res.status < 500;
			throw err;
		} catch (err) {
			if (err.fatal || attempt >= CONFIG.retries) throw err;
			progressDetail.textContent =
				"Batch failed, retrying (" + (attempt + 1) + " of " + CONFIG.retries + ")…";
			await sleep(1000 * (attempt + 1));
		}
	}
}

// Demo: pretend there are 9,50,000 rows and fetch them batch by batch.
async function runDemo() {
	progressLabel.textContent = "Running query on the server…";
	setProgress(null);
	await sleep(1500);

	const total = 950000;
	const totalBatches = Math.ceil(total / CONFIG.batchSize);
	const header =
		"cif_id,foracid,bacid,acct_name,sol_id,gl_sub_head_code,tran_id,tran_date,tran_type,tran_amt\r\n";
	const parts = [];
	const durations = [];

	for (let n = 1; n <= totalBatches; n++) {
		const t0 = performance.now();
		progressLabel.textContent = "Downloading batch " + n + " of " + totalBatches + "…";
		await sleep(450);
		let body =
			"C000123,0011000123,BA001,SAMPLE ACCOUNT,001,10101,S" +
			(1000000 + n) +
			",2026-01-05,C,5000.00\r\n";
		if (n === 1) body = upperCaseHeader(header + body);
		parts.push(new Blob([body], { type: CSV_TYPE }));
		durations.push(performance.now() - t0);
		reportBatch(n, totalBatches, Math.min(n * CONFIG.batchSize, total), total, durations);
	}
	return { parts, total };
}

// Real: ask the backend for offset 0, 50000, 100000 ... until every row is fetched.
async function runReal(params) {
	progressLabel.textContent = "Running query on the server…";
	setProgress(null);

	const parts = [];
	const durations = [];
	let total = null;
	let totalBatches = 0;
	let offset = 0;
	let batchNo = 0;

	while (total === null || offset < total) {
		const t0 = performance.now();
		if (total !== null) {
			progressLabel.textContent =
				"Downloading batch " + (batchNo + 1) + " of " + totalBatches + "…";
		}

		const result = await fetchBatch(params, offset);

		if (total === null) {
			total = Number(result.total);
			if (!Number.isFinite(total) || total === 0)
				throw new Error("No posted transactions found for this account and date range.");
			totalBatches = Math.ceil(total / CONFIG.batchSize);
			parts.push(new Blob([upperCaseHeader(result.csv)], { type: CSV_TYPE }));
		} else {
			parts.push(new Blob([result.csv], { type: CSV_TYPE }));
		}

		batchNo++;
		offset += CONFIG.batchSize;
		durations.push(performance.now() - t0);
		reportBatch(batchNo, totalBatches, Math.min(offset, total), total, durations);
	}
	return { parts, total };
}

// ---- Submit --------------------------------------------------------------
form.addEventListener("submit", async (e) => {
	e.preventDefault();
	statusBox.hidden = true;

	const params = validate();
	if (!params) return;

	const safeValue = params.account_value.replace(/[^\w.-]+/g, "_");
	const reportName =
		`${params.account_type}_${safeValue}_${params.start_date}_to_${params.end_date}.csv`.toUpperCase();

	btn.disabled = true;
	btn.textContent = "Downloading…";
	bar.classList.remove("done");
	progressDetail.textContent = "";
	progressBox.hidden = false;
	startTimer();

	try {
		const { parts, total } = CONFIG.demo ? await runDemo() : await runReal(params);

		// All batches are in: join them into one file and hand it to the browser.
		progressLabel.textContent = "Preparing file…";
		const blob = new Blob(parts, { type: CSV_TYPE });
		const elapsed = stopTimer();

		setProgress(100);
		bar.classList.add("done");
		progressLabel.textContent = "Download complete";
		progressDetail.textContent =
			"Completed in " +
			fmtTime(elapsed) +
			" · " +
			nf.format(total) +
			" rows · " +
			fmtBytes(blob.size);

		saveBlob(blob, reportName);
		showStatus("success", "Report downloaded: " + reportName);
	} catch (err) {
		stopTimer();
		progressBox.hidden = true;
		showStatus("error", err.message || "Something went wrong. Try again.");
	} finally {
		btn.disabled = false;
		btn.textContent = "Download report";
	}
});

// Clear a field's error as soon as the user edits it
fields.account.input.addEventListener("input", () => setError("account", ""));
fields.start.input.addEventListener("input", () => setError("start", ""));
fields.end.input.addEventListener("input", () => setError("end", ""));

// DB Connectivity Status (Admin only)
const dbToggle = document.getElementById("db-status-toggle");
const dbDetails = document.getElementById("db-status-details");
const dbIcon = document.getElementById("db-status-icon");
const dbDot = document.getElementById("db-status-dot");
const dbText = document.getElementById("db-status-text");
const dbInfo = document.getElementById("db-status-info");

if (dbToggle) {
	dbToggle.addEventListener("click", async () => {
		const isOpen = dbDetails.style.display !== "none";
		dbDetails.style.display = isOpen ? "none" : "block";
		dbIcon.textContent = isOpen ? "▶" : "▼";

		if (!isOpen && !dbDot.dataset.loaded) {
			dbDot.style.background = "#ffc107";
			dbText.textContent = "Checking connection...";

			try {
				const res = await fetch("/api/method/custom_report.www.double_leg_transaction.check_db_connectivity");
				const data = await res.json();
				const result = data.message || data;

				if (result.status === "connected") {
					dbDot.style.background = "#1d6b3c";
					dbText.textContent = "Connected";
					dbInfo.innerHTML = `
						<div><strong>Latency:</strong> ${result.latency_ms} ms</div>
						<div><strong>DB Version:</strong> ${result.db_version || "-"}</div>
						<div><strong>Server Time:</strong> ${result.db_time || "-"}</div>
					`;
				} else if (result.status === "forbidden") {
					dbDot.style.background = "#ccc";
					dbText.textContent = result.message;
					dbInfo.innerHTML = "";
				} else {
					dbDot.style.background = "#a6262b";
					dbText.textContent = "Connection failed";
					dbInfo.innerHTML = `<div><strong>Error:</strong> ${result.message || "Unknown error"}</div>`;
				}
				dbDot.dataset.loaded = "true";
			} catch (err) {
				dbDot.style.background = "#a6262b";
				dbText.textContent = "Failed to check connectivity";
				dbInfo.innerHTML = `<div>${err.message}</div>`;
			}
		}
	});
}
