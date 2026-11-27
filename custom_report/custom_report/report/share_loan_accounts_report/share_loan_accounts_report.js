frappe.query_reports["Share Loan Accounts Report"] = {
	filters: [
		{
			fieldname: "share_application",
			label: __("Share Application"),
			fieldtype: "Link",
			options: "Share Application",
		},
		{
			fieldname: "loan_acct_num",
			label: __("Loan Account Number"),
			fieldtype: "Data",
		},
		{
			fieldname: "sol_id",
			label: __("SOL ID"),
			fieldtype: "Data",
		},
		{
			fieldname: "refund_status",
			label: __("Refund Status"),
			fieldtype: "Select",
			options: "\nPending\nEligible\nIn Progress\nSuccess\nFailed",
		},
		{
			fieldname: "from_date",
			label: __("From Date"),
			fieldtype: "Date",
		},
		{
			fieldname: "to_date",
			label: __("To Date"),
			fieldtype: "Date",
		},
	],

	onload(report) {
		if (!document.getElementById("share-loan-sticky-action-style")) {
			const style = document.createElement("style");
			style.id = "share-loan-sticky-action-style";
			style.textContent = `
				.report-wrapper .dt-cell--col-1 {
					position: sticky !important;
					left: 0 !important;
					z-index: 2 !important;
					background: var(--card-bg, #ffffff) !important;
					box-shadow: 2px 0 4px rgba(0, 0, 0, 0.06);
				}
				.report-wrapper .dt-header .dt-cell--col-1,
				.report-wrapper .dt-row-filter .dt-cell--col-1 {
					z-index: 3 !important;
					background: var(--subtle-fg, #f4f5f6) !important;
				}
				.report-wrapper .dt-scrollable .dt-row:hover .dt-cell {
					background-color: var(--control-bg, #f1f5f9) !important;
				}
				.report-wrapper .dt-scrollable .dt-row:hover .dt-cell--col-1 {
					background-color: var(--control-bg, #f1f5f9) !important;
				}
				.share-loan-closed-cell {
					background-color: rgba(239, 68, 68, 0.08);
					color: var(--red-600, #991b1b);
					font-weight: 600;
					padding: 2px 6px;
					margin: -2px -6px;
				}
				.share-loan-success-cell {
					background-color: rgba(34, 197, 94, 0.12);
					color: var(--green-700, #15803d);
					font-weight: 600;
					padding: 2px 6px;
					margin: -2px -6px;
				}
			`;
			document.head.appendChild(style);
		}

		$(report.page.wrapper)
			.off("click.shareLoanReport")
			.on("click.shareLoanReport", ".share-loan-action-btn", function (ev) {
				open_report_row_actions(ev, $(this).attr("data-key"));
			});

		report.page.add_inner_button(__("Sync Loan Accounts"), () => {
			frappe.call({
				method: "custom_report.api.share_application_sync.sync_share_loan_accounts_from_report",
				freeze: true,
				freeze_message: __("Syncing latest Loan Accounts from Finacle..."),
				callback(r) {
					const res = r.message || {};
					frappe.show_alert({
						message: res.message || __("Loan accounts synced successfully."),
						indicator: "green",
					});
					report.refresh();
				},
			});
		});
	},

	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		const row_cell_class =
			data && data.refund_status === "Success"
				? "share-loan-success-cell"
				: data && data.acct_cls_date
					? "share-loan-closed-cell"
					: "";
		const wrap_cell = (content) =>
			row_cell_class ? `<div class="${row_cell_class}">${content}</div>` : content;

		if (column.fieldname === "certificate" && data && data.parent) {
			window.__share_loan_report_rows = window.__share_loan_report_rows || {};
			const key = String(data.name || data.loan_acct_num || data.parent);
			window.__share_loan_report_rows[key] = {
				name: data.name || "",
				parent: data.parent,
				loan_acct_num: data.loan_acct_num || "",
				tran_amt: data.tran_amt || 0,
				refund_status: data.refund_status || "",
			};
			const safe_key = frappe.utils.escape_html(key);
			const btn = `<button type="button" class="btn btn-xs btn-default share-loan-action-btn" data-key="${safe_key}">${__("Action")} <i class="fa fa-caret-down"></i></button>`;
			return wrap_cell(btn);
		}
		if (column.fieldname === "refund_status" && value && data && data.parent) {
			const color_map = {
				Eligible: "blue",
				Pending: "orange",
				"In Progress": "yellow",
				Success: "green",
				Failed: "red",
			};
			const color = color_map[data.refund_status] || "gray";
			const pill = `<span class="indicator-pill ${color}">${value}</span>`;
			return wrap_cell(pill);
		}
		return wrap_cell(value);
	},
};

function open_report_row_actions(ev, row_key) {
	if (ev) {
		ev.stopPropagation();
	}
	$("#report-row-action-menu").remove();

	const row_info = (window.__share_loan_report_rows || {})[row_key];
	if (!row_info || !ev || !ev.currentTarget) return;

	const rect = ev.currentTarget.getBoundingClientRect();
	const items = [
		`<a class="dropdown-item" href="#" data-action="print"><i class="fa fa-print mr-2"></i>${__("Print Certificate")}</a>`,
	];
	if (row_info.refund_status === "Eligible") {
		items.push(
			`<a class="dropdown-item text-success" href="#" data-action="pay"><i class="fa fa-credit-card mr-2"></i>${__("Pay Now")}</a>`
		);
	}
	items.push(
		`<a class="dropdown-item" href="#" data-action="open"><i class="fa fa-external-link mr-2"></i>${__("Open Share Application")}</a>`
	);

	const $menu = $(`
		<div id="report-row-action-menu" class="dropdown-menu show" style="position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left}px; z-index: 1050; min-width: 180px;">
			${items.join("")}
		</div>
	`).appendTo("body");

	$menu.on("click", "a[data-action]", function (e) {
		e.preventDefault();
		const action = $(this).attr("data-action");
		$menu.remove();
		if (action === "print") {
			open_report_share_certificate(row_key);
		} else if (action === "pay") {
			pay_now_report_share_app(row_key);
		} else if (action === "open") {
			frappe.set_route("Form", "Share Application", row_info.parent);
		}
	});

	$(document)
		.off("click.reportRowAction")
		.on("click.reportRowAction", function () {
			$("#report-row-action-menu").remove();
			$(document).off("click.reportRowAction");
		});
}

function pay_now_report_share_app(row_key) {
	const row_info = (window.__share_loan_report_rows || {})[row_key];
	if (!row_info || !row_info.parent || !row_info.loan_acct_num) return;

	frappe.call({
		method: "custom_report.api.share_application_sync.get_loan_refund_preview",
		args: {
			share_application: row_info.parent,
			loan_acct_num: row_info.loan_acct_num,
		},
		freeze: true,
		freeze_message: __("Loading payment preview..."),
		callback(r) {
			const info = r.message;
			if (!info) return;

			const esc = frappe.utils.escape_html;
			const formatted_amt = format_currency(info.amount);
			const html = `
				<div style="font-size: 13px;">
					<div style="margin-bottom: 10px;">
						<strong>${__("Loan Account")}:</strong> ${esc(info.loan_acct_num)} &nbsp;|&nbsp;
						<strong>${__("Customer")}:</strong> ${esc(info.acct_name)} &nbsp;|&nbsp;
						<strong>${__("Branch")}:</strong> ${esc(info.branch_name || "-")} (${esc(info.sol_id || "-")})
					</div>
					<table class="table table-bordered" style="margin-bottom: 0;">
						<thead style="background: #f8fafc;">
							<tr>
								<th>${__("Entry Type")}</th>
								<th>${__("Account Number / GL")}</th>
								<th>${__("Details")}</th>
								<th>${__("Tran Particular")}</th>
								<th style="text-align: right;">${__("Amount")}</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td><span class="indicator-pill red">${__("Debit")}</span></td>
								<td><strong>${esc(info.debit_account || __("Not Set in Settings"))}</strong></td>
								<td>${__("Loan Share Account GL")}</td>
								<td><code>${esc(info.debit_tran_particular || "-")}</code></td>
								<td style="text-align: right; font-weight: 600;">${formatted_amt}</td>
							</tr>
							<tr>
								<td><span class="indicator-pill green">${__("Credit")}</span></td>
								<td><strong>${esc(info.credit_account || "-")}</strong></td>
								<td>${esc(info.credit_account_type || "CASA")} (${esc(info.acct_name)})</td>
								<td><code>${esc(info.credit_tran_particular || "-")}</code></td>
								<td style="text-align: right; font-weight: 600;">${formatted_amt}</td>
							</tr>
						</tbody>
					</table>
				</div>
			`;

			const d = new frappe.ui.Dialog({
				title: __("Pay Now Preview ({0})", [info.loan_row_name]),
				size: "extra-large",
				fields: [{ fieldname: "preview_html", fieldtype: "HTML", options: html }],
				primary_action_label: __("Pay Now"),
				primary_action() {
					frappe.confirm(
						__("Confirm fund transfer of {0} from {1} to {2}?", [
							formatted_amt,
							esc(info.debit_account || "-"),
							esc(info.credit_account || "-"),
						]),
						() => {
							frappe.call({
								method: "custom_report.api.share_application_sync.execute_loan_refund_transfer",
								args: {
									share_application: info.share_application,
									loan_acct_num: info.loan_acct_num,
								},
								freeze: true,
								freeze_message: __("Processing Finacle fund transfer..."),
								callback(res) {
									const result = res.message || {};
									if (result.status === "success") {
										d.hide();
										frappe.show_alert({
											message: result.message || __("Fund transfer completed."),
											indicator: "green",
										});
									} else {
										frappe.msgprint({
											title: __("Fund Transfer Failed"),
											message: esc(result.message || __("Unable to process fund transfer.")),
											indicator: "red",
										});
									}
									if (frappe.query_report) {
										frappe.query_report.refresh();
									}
								},
							});
						}
					);
				},
			});
			d.show();
		},
	});
}

function open_report_share_certificate(row_key) {
	const row_info = (window.__share_loan_report_rows || {})[row_key] || {
		parent: row_key,
		loan_acct_num: "",
		tran_amt: 0,
	};
	if (!row_info.parent) return;

	frappe.db
		.get_value("Share Application", row_info.parent, [
			"name",
			"account_number",
			"customer_name",
			"address",
			"cif_creation_date",
		])
		.then((res) => {
			const doc = res && res.message;
			if (!doc) {
				frappe.msgprint(__("Share Application {0} not found.", [row_info.parent]));
				return;
			}
			open_report_share_certificate_dialog(doc, row_info);
		});
};

function open_report_share_certificate_dialog(doc, row_info) {
	frappe.call({
		method: "banking_api.banking_api.doctype.share_application_settings.share_application_settings.get_share_certificate_image",
		freeze: true,
		freeze_message: __("Loading share certificate template..."),
		callback(r) {
			if (!r.message || r.message.status !== "success" || !r.message.image_url) {
				frappe.msgprint({
					title: __("Certificate Image Missing"),
					message: __("Share Certificate Image is not set in Share Application Settings."),
					indicator: "red",
				});
				return;
			}

			const image_url = r.message.image_url;
			const today = frappe.datetime.nowdate();
			const tran_amt = Number((row_info && row_info.tran_amt) || 0);
			const qty = tran_amt >= 10 ? Math.floor(tran_amt / 10) : 1;
			const cert_no = (row_info && row_info.name) || doc.name || "";
			const cert_data = {
				share_certificate_no: cert_no,
				account_no: (row_info && row_info.loan_acct_num) || doc.account_number || "",
				name: doc.customer_name || "",
				address: doc.address || "",
				number_of_share: String(qty),
				from_no: "1",
				to_no: String(qty),
				rs: String(tran_amt > 0 ? tran_amt : 10),
				issued_date: doc.cif_creation_date
					? frappe.datetime.str_to_user(doc.cif_creation_date)
					: frappe.datetime.str_to_user(today),
			};

			const positions = {
				certificate: {
					share_certificate_no: { top: 169, left: 495, width: 150, font_size: 12 },
					account_no: { top: 179, left: 821, width: 120, font_size: 12 },
					name: { top: 234, left: 454, width: 490, font_size: 12 },
					address: { top: 262, left: 418, width: 540, font_size: 11 },
					number_of_share: { top: 288, left: 544, width: 55, font_size: 12 },
					from_no: { top: 288, left: 765, width: 65, font_size: 12 },
					to_no: { top: 288, left: 904, width: 70, font_size: 12 },
					rs: { top: 315, left: 882, width: 80, font_size: 12 },
					issued_date: { top: 480, left: 630, width: 150, font_size: 12 },
				},
				receipt: {
					share_certificate_no: { top: 28, left: 24, width: 120, font_size: 12 },
					account_no: { top: 28, left: 203, width: 115, font_size: 12 },
					name: { top: 174, left: 78, width: 250, font_size: 12 },
					address: { top: 216, left: 52, width: 290, font_size: 11 },
					number_of_share: { top: 256, left: 184, width: 40, font_size: 12 },
					from_no: { top: 276, left: 113, width: 75, font_size: 12 },
					to_no: { top: 276, left: 265, width: 65, font_size: 12 },
					rs: { top: 317, left: 164, width: 70, font_size: 12 },
					issued_date: { top: 481, left: 187, width: 130, font_size: 12 },
				},
			};

			const d = new frappe.ui.Dialog({
				title: __("Share Certificate Preview"),
				size: "extra-large",
				fields: [{ fieldname: "html_preview", fieldtype: "HTML" }],
				primary_action_label: __("Download PDF"),
				primary_action() {
					download_report_share_certificate_pdf(cert_no);
				},
			});
			d.show();

			d.fields_dict.html_preview.$wrapper.html(`
				<div style="overflow:auto; max-height:75vh; border:1px solid #d1d8dd; background:#f5f7fa; padding:16px;">
					<div id="share-certificate-preview" style="position: relative; width: 1000px; margin: 0 auto; background: #fff;">
						<img src="${image_url}" alt="Share Certificate" style="width: 100%; display: block;" />
					</div>
				</div>
			`);

			const preview = d.fields_dict.html_preview.$wrapper.find("#share-certificate-preview")[0];
			const addText = (key, value, cfg) => {
				const node = document.createElement("div");
				node.className = "share-cert-text";
				node.setAttribute("data-key", key);
				node.style.position = "absolute";
				node.style.top = `${cfg.top}px`;
				node.style.left = `${cfg.left}px`;
				node.style.width = `${cfg.width}px`;
				node.style.fontSize = `${cfg.font_size}px`;
				node.style.lineHeight = "1.2";
				node.style.fontWeight = "600";
				node.style.color = "#111";
				node.style.fontFamily = "Arial, sans-serif";
				const should_wrap = key.includes("address") || key.includes("name");
				node.style.whiteSpace = should_wrap ? "normal" : "nowrap";
				node.style.wordBreak = should_wrap ? "break-word" : "normal";
				node.style.overflowWrap = should_wrap ? "break-word" : "normal";
				node.textContent = value || "";
				preview.appendChild(node);
			};

			Object.keys(cert_data).forEach((key) => {
				addText(`certificate_${key}`, cert_data[key], positions.certificate[key]);
				addText(`receipt_${key}`, cert_data[key], positions.receipt[key]);
			});
		},
	});
}

function download_report_share_certificate_pdf(docname) {
	const target = document.getElementById("share-certificate-preview");
	if (!target) {
		frappe.msgprint(__("Preview not found."));
		return;
	}

	const load_script = (src) =>
		new Promise((resolve, reject) => {
			if (document.querySelector(`script[src="${src}"]`)) return resolve();
			const script = document.createElement("script");
			script.src = src;
			script.onload = resolve;
			script.onerror = reject;
			document.head.appendChild(script);
		});

	Promise.all([
		load_script("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"),
		load_script("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"),
	])
		.then(() => {
			frappe.dom.freeze(__("Generating PDF..."));
			return window.html2canvas(target, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
		})
		.then((canvas) => {
			const imgData = canvas.toDataURL("image/png");
			const { jsPDF } = window.jspdf;
			const pdf = new jsPDF("l", "mm", "a4");
			const pdfWidth = pdf.internal.pageSize.getWidth();
			const pdfHeight = pdf.internal.pageSize.getHeight();
			const ratio = Math.min(pdfWidth / canvas.width, pdfHeight / canvas.height);
			const finalWidth = canvas.width * ratio;
			const finalHeight = canvas.height * ratio;
			pdf.addImage(
				imgData,
				"PNG",
				(pdfWidth - finalWidth) / 2,
				(pdfHeight - finalHeight) / 2,
				finalWidth,
				finalHeight
			);
			pdf.save(`Share-Certificate-${docname}.pdf`);
		})
		.catch(() => frappe.msgprint(__("Failed to generate PDF.")))
		.finally(() => frappe.dom.unfreeze());
}
