// ============================================================================
// DRISHTI PERFORMANCE DASHBOARD - COMPLETE FUNCTIONAL VERSION
// Version: 6.0.0 | All Issues Fixed
// ============================================================================

const getRemainingWorkingDaysExcludingSundays = (year, monthIndex, currentDay) => {
	const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate();
	let workingDays = 0;
	for (let day = currentDay; day <= lastDayOfMonth; day++) {
		const date = new Date(year, monthIndex, day);
		if (date.getDay() !== 0) {
			// 0 represents Sunday
			workingDays++;
		}
	}
	return workingDays;
};

frappe.pages["sahayog_dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Drishti",
		single_column: true,
	});

	// Style the title heading dynamically with bold styling
	$(wrapper)
		.find(".title-text")
		.html(
			"<span style=\"font-weight: 800; color: #417d81; font-size: 24px; letter-spacing: -0.5px; font-family: 'Inter', sans-serif;\">Drishti</span>",
		);
	$(wrapper)
		.find(".title-text")
		.after(
			'<div id="drishti-subtitle" style="font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 500; font-family: \'Inter\', sans-serif;">Updated till: Loading...</div>',
		);

	wrapper.dashboard = new DrishtiDashboard(page);
};

frappe.pages["sahayog_dashboard"].on_page_show = function (wrapper) {
	// Inject Drishti title
	document.title = "Drishti";
	if ($("head title").length) {
		$("head title").text("Drishti");
	} else {
		$("<title>Drishti</title>").appendTo("head");
	}

	// Reset all caches so dashboard behaves like a fresh load every time
	if (wrapper.dashboard) {
		wrapper.dashboard.resetAllCaches();
		// Trigger fresh data load after cache reset
		if (wrapper.dashboard._fyLoaded) {
			wrapper.dashboard.loadData();
		}
	}

	// Fetch and update latest date subtitle
	frappe.call({
		method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_latest_branch_category_report_date",
		callback: function (r) {
			if (r.message) {
				const dateParts = r.message.split("-");
				const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
				$(wrapper)
					.find("#drishti-subtitle")
					.text("Updated till: " + formattedDate);
			} else {
				$(wrapper).find("#drishti-subtitle").text("");
			}
		},
	});

	// Clean up any old unmanaged container style tags from previous development sessions
	$("head style").each(function () {
		const text = $(this).text();
		if (
			text.includes(".container") &&
			text.includes("max-width: 100%") &&
			!text.includes(".sahayog-dashboard-full-width")
		) {
			$(this).remove();
		}
	});

	// Add full width class to body for page-specific styling
	$("body").addClass("sahayog-dashboard-full-width");

	// Inject custom breadcrumbs with live timer
	setTimeout(() => {
		const $breadcrumbs = $("#navbar-breadcrumbs");
		if ($breadcrumbs.length) {
			$breadcrumbs.html(`
				<li><a href="/app/sahayog-home" class="btn btn-default btn-xs" style="font-weight: 700; border-radius: 6px; padding: 2px 8px; color: #1e293b; border: 1px solid #cbd5e1; background-color: #f1f5f9; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); margin-right: 4px;">Back</a></li>
				<li style="display: inline-flex; align-items: center;">
					<!-- Working Days Left -->
					<div style="display: inline-flex; align-items: center; margin-left: 10px; vertical-align: middle;">
						<span id="drishti-header-timer" class="days-left-blink" style="font-size: 12px;"></span>
					</div>
				</li>
			`);

			// Set initial format toggle state from URL or state default
			const urlParams = new URLSearchParams(window.location.search);
			const formatMode = urlParams.get("formatMode") || "words";
			$breadcrumbs
				.find(`.format-toggle-btn[data-format="${formatMode}"]`)
				.addClass("active");

			// Repopulate headers if dashboard instance exists
			if (wrapper.dashboard) {
				wrapper.dashboard.repopulateHeaderFilters();
				wrapper.dashboard.setupHeaderToggle();
			}

			// Clear any existing interval
			if (frappe.pages["sahayog_dashboard"].timer_interval) {
				clearInterval(frappe.pages["sahayog_dashboard"].timer_interval);
				frappe.pages["sahayog_dashboard"].timer_interval = null;
			}

			const updateDrishtiTimer = () => {
				const $timer = $("#drishti-live-timer");
				if ($timer.length) {
					$timer.hide();
				}

				const $headerTimer = $("#drishti-header-timer");
				if ($headerTimer.length) {
					const now = new Date();
					const year = now.getFullYear();
					const currentMonthIndex = now.getMonth();
					const currentDay = now.getDate();

					const workingDaysLeft = getRemainingWorkingDaysExcludingSundays(
						year,
						currentMonthIndex,
						currentDay,
					);
					const daysLeftText =
						workingDaysLeft === 1
							? "1 Working Day Left"
							: `${workingDaysLeft} Working Days Left`;

					$headerTimer.html(daysLeftText);
				}
			};

			updateDrishtiTimer();
		}
	}, 100);
};

frappe.pages["sahayog_dashboard"].on_page_hide = function (wrapper) {
	// Remove full width class from body
	$("body").removeClass("sahayog-dashboard-full-width");

	// Clear interval to avoid memory leaks
	if (frappe.pages["sahayog_dashboard"].timer_interval) {
		clearInterval(frappe.pages["sahayog_dashboard"].timer_interval);
		frappe.pages["sahayog_dashboard"].timer_interval = null;
	}
};

const filterMisTableDataByUserPermissions = function (data, filterOptions) {
	if (!data || !Array.isArray(data)) return [];
	if (!filterOptions) return data;

	const perms = filterOptions.permissions || {};

	// If user is not restricted (Admin / HO user), return full cached dataset
	if (!perms.is_restricted) {
		return data;
	}

	const allowedZones = perms.allowed_zones || [];
	const allowedRegions = perms.allowed_regions || [];
	const allowedSolIds = (perms.allowed_sol_ids || []).map(s => String(s).trim());

	const hasZonePerms = allowedZones.length > 0;
	const hasRegionPerms = allowedRegions.length > 0;
	const hasSolPerms = allowedSolIds.length > 0;

	// 1. Explicit Zone permissions
	if (hasZonePerms) {
		let filtered = data.filter(r => r.zone && allowedZones.includes(r.zone));
		if (hasRegionPerms) {
			filtered = filtered.filter(r => r.region && allowedRegions.includes(r.region));
		}
		return filtered;
	}

	// 2. Explicit Region permissions
	if (hasRegionPerms) {
		return data.filter(r => r.region && allowedRegions.includes(r.region));
	}

	// 3. Explicit SOL ID permissions (Single or Multiple SOL access)
	if (hasSolPerms) {
		const solSet = new Set(allowedSolIds);
		return data.filter(r => r.sol_id && solSet.has(String(r.sol_id).trim()));
	}

	// 4. Fallback based on filterOptions.zones
	if (filterOptions.zones && filterOptions.zones.length > 0) {
		const zoneSet = new Set(filterOptions.zones);
		return data.filter(r => r.zone && zoneSet.has(r.zone));
	}

	return data;
};

class DrishtiDashboard {
	constructor(page) {
		this.page = page;
		this.state = {
			financialYear: null,
			activeTab: "zone",
			viewType: "Monthly",
			targetType: "Monthly",
			formatMode: "words",
			selectedDate: null,
			selectedCategories: [],
			selectedZones: [],
			selectedRegions: [],
			selectedDistricts: [],
			branchSearchTerm: "",
			selectedMonth: null,
			drillDownActive: false,
			expandedZones: {}, // Track expanded/collapsed zones
			expandedZoneRegions: {}, // Track expanded/collapsed regions in zone table
			checkedZoneRows: {}, // Track checked rows in zone table
			expandedProductRows: {},
			checkedProductRows: {},
			selectedSegment: "all",
			dashboardMode: "drishti",
			selectedMisReport: "rd_smbg_pending",
		};
		// Store selected date per tab
		this.tabDates = {
			zone: null,
			category: null,
			product: null,
			agent: null,
			branch: null,
		};
		this.data = null;
		this.availableFilters = {
			categories: ["Pinnacle", "Master", "Accelerator", "Starter", "Learner", "Zero Level"],
			zones: [],
			regions: [],
			districts: [],
		};
		this.categoryCounts = {};
		this.zoneCounts = {};
		this.productData = [];

		// Dashboard containers for Drishti / MIS toggle
		this.drishti_container = null;
		this.mis_container = null;

		// Registered MIS Reports configuration
		this.misReportsList = [
			{
				id: "rd_smbg_pending",
				name: "RD & SMBG Pending",
				tableData: [],
				filterOptions: null,
				expandedZones: {},
				expandedRegions: {},
				expandedDistricts: {},
				checkedRows: {},
				searchTerm: "",
				allExpanded: false,
				selectedMisZones: [],
				render: function (container, dashboardInstance, seq) {
					const self = this;
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<input type="text" id="mis-search" placeholder="Search branch, SOL ID or district..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 200px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="mis-expand-toggle" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">▼ Expand All</button>
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
								<span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
								<div class="btn-group mis-format-toggle" role="group">
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
								</div>
							</div>
							<div style="font-size: 13px; font-weight: 700; color: #417d81; background: rgba(65,125,129,0.08); padding: 6px 12px; border-radius: 6px;" id="mis-records-count"></div>
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							<style>
								.mis-skeleton-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #fff; }
								.mis-skeleton-table th { background: #f1f5f9; padding: 10px 12px; border-bottom: 1px solid #cbd5e1; font-weight: 600; font-size: 12px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }
								.mis-skeleton-table td { padding: 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
								.mis-skeleton-pulse { background: linear-gradient(-90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%); background-size: 400% 400%; animation: mis-shimmer 1.5s ease-in-out infinite; border-radius: 4px; height: 16px; }
								@keyframes mis-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
							</style>
							<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
								<div class="spinner-border text-primary" role="status" style="width: 1.2rem; height: 1.2rem; border-width: 0.15em; color: #417d81 !important; animation: spinner-border .75s linear infinite;"></div>
								<span style="font-weight: 600; color: #417d81; font-size: 13px;">Fetching latest RD & SMBG data...</span>
							</div>
							<table class="mis-skeleton-table">
								<thead><tr>
									<th style="width: 30px;"><div class="mis-skeleton-pulse" style="width: 14px; height: 14px;"></div></th>
									<th style="width: 40px; text-align: center;">Sr</th>
									<th>Z / R / D / SOL Name</th>
									<th style="text-align: center; width: 80px;">Branches</th>
									<th style="text-align: right; width: 100px;">Total Accounts</th>
									<th style="text-align: right; width: 120px;">Total Collection</th>
									<th style="text-align: right; width: 110px;">Pending Accounts</th>
									<th style="text-align: right; width: 110px;">Pending Inst.</th>
									<th style="text-align: right; width: 120px;">Pending Amount</th>
								</tr></thead>
								<tbody>
									${[1,2,3,4,5].map(i => `<tr style="background: ${i%2===0 ? '#f8fafc' : '#fff'};">
										<td><div class="mis-skeleton-pulse" style="width: 14px; height: 14px; margin: auto;"></div></td>
										<td><div class="mis-skeleton-pulse" style="width: 20px; margin: auto;"></div></td>
										<td><div class="mis-skeleton-pulse" style="width: ${120 + Math.random()*60}px;"></div></td>
										<td><div class="mis-skeleton-pulse" style="width: 30px; margin: auto;"></div></td>
										<td><div class="mis-skeleton-pulse" style="width: ${50 + Math.random()*30}px; margin-left: auto;"></div></td>
										<td><div class="mis-skeleton-pulse" style="width: ${60 + Math.random()*30}px; margin-left: auto;"></div></td>
										<td><div class="mis-skeleton-pulse" style="width: ${50 + Math.random()*20}px; margin-left: auto;"></div></td>
										<td><div class="mis-skeleton-pulse" style="width: ${40 + Math.random()*20}px; margin-left: auto;"></div></td>
										<td><div class="mis-skeleton-pulse" style="width: ${60 + Math.random()*30}px; margin-left: auto;"></div></td>
									</tr>`).join('')}
								</tbody>
							</table>
						</div>
						<div id="mis-zone-filter-row" style="display: none; margin-bottom: 10px;"></div>
						<div id="mis-kpi-container"${self.tableData && self.tableData.length ? "" : ' style="display: none;"'}></div>
						<div id="mis-table-container"${self.tableData ? "" : ' style="display: none;"'}></div>
					`);

					const applyUserPermissionsAndRender = function () {
						self.tableData = filterMisTableDataByUserPermissions(self.rawTableData, self.filterOptions);
						self.loadedUser = frappe.session.user;

						self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
						container.find("#mis-records-count").text(`${self.tableData.length} branches`);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
						container.find("#mis-loading").hide();
						container.find("#mis-controls, #mis-table-container, #mis-kpi-container, #mis-zone-filter-row").show();
						self.attachReportEventHandlers(container, dashboardInstance);
					};

					if (self.loadedUser && self.loadedUser !== frappe.session.user) {
						self.rawTableData = [];
						self.tableData = [];
						self.filterOptions = null;
						self.loadedUser = null;
					}

					if (self.rawTableData && self.rawTableData.length > 0 && self.filterOptions && self.loadedUser === frappe.session.user) {
						applyUserPermissionsAndRender();
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_mis_filter_options",
						callback: function (r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							if (r.message) {
								self.filterOptions = r.message;

								if (self.rawTableData && self.rawTableData.length > 0) {
									applyUserPermissionsAndRender();
									return;
								}

								console.log("DEBUG: API CALL get_rd_smbg_pending_table_data START");
								frappe.call({
									method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_rd_smbg_pending_table_data",
									callback: function (r3) {
										console.log("DEBUG: API CALL get_rd_smbg_pending_table_data RESPONSE", r3.message ? r3.message.length : 0);
										if (dashboardInstance._misRenderSeq !== seq) return;
										if (r3.message) {
											self.rawTableData = r3.message;
											applyUserPermissionsAndRender();
										} else {
											container.find("#mis-loading").hide();
										}
									}
								});
							}
						}
					});
					self.attachReportEventHandlers(container, dashboardInstance);
				},
				attachReportEventHandlers: function (container, dashboardInstance) {
					const self = this;
					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").each(function () {
							const btn = $(this);
							const isActive = btn.data("format") === format;
							btn.css("background", isActive ? "#417d81" : "#e2e8f0");
							btn.css("color", isActive ? "white" : "#475569");
						});
						if (self.tableData && self.tableData.length > 0) {
							self.switchFormat(format, container, dashboardInstance);
						}
					});
					let searchTimeout;
					container.off("input", "#mis-search").on("input", "#mis-search", function () {
						clearTimeout(searchTimeout);
						searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (self.tableData) {
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
							}
						}, 300);
					});
					container.off("click", "#mis-expand-toggle").on("click", "#mis-expand-toggle", function () {
						self.allExpanded = !self.allExpanded;
						const expand = self.allExpanded;
						if (!self.tableData) return;
						const zoneData = self.aggregateByZone();
						zoneData.forEach(z => {
							self.expandedZones[z.zone] = expand;
							z.regions.forEach(r => {
								self.expandedRegions[z.zone + "::" + r.region] = expand;
								r.districts.forEach(d => {
									self.expandedDistricts[z.zone + "::" + r.region + "::" + d.district] = expand;
								});
							});
						});
						$(this).text(expand ? "▲ Collapse All" : "▼ Expand All");
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.refetchData(container, dashboardInstance);
					});
				},
				renderKPI: function (container, dashboardInstance) {
					const self = this;
					const data = self.tableData || [];
					const totalAccounts = data.reduce((s, r) => s + (r.total_accounts || 0), 0);
					const totalCollection = data.reduce((s, r) => s + (r.total_collection || 0), 0);
					const pendingAccounts = data.reduce((s, r) => s + (r.pending_accounts || 0), 0);
					const pendingInstalments = data.reduce((s, r) => s + (r.pending_instalments || 0), 0);
					const pendingAmount = data.reduce((s, r) => s + (r.pending_amount || 0), 0);
					const fmtCount = (val) => {
						if (!val && val !== 0) return "0";
						return new Intl.NumberFormat("en-IN").format(val);
					};
					const fmtAmt = (val) => {
						if (!val || val === 0) return "₹0";
						return "₹" + dashboardInstance.formatCurrency(val);
					};
					const kpiCards = [
						{ label: "Total Accounts", value: fmtCount(totalAccounts), color: "#3b82f6", bg: "#eff6ff", icon: "📊" },
						{ label: "Total Collection", value: fmtAmt(totalCollection), color: "#10b981", bg: "#ecfdf5", icon: "💰" },
						{ label: "Pending Accounts", value: fmtCount(pendingAccounts), color: "#f59e0b", bg: "#fffbeb", icon: "⏳" },
						{ label: "Pending Instalments", value: fmtCount(pendingInstalments), color: "#f97316", bg: "#fff7ed", icon: "📅" },
						{ label: "Pending Amount", value: fmtAmt(pendingAmount), color: "#ef4444", bg: "#fef2f2", icon: "🔴" }
					];
					container.html(`
						<style>
							#mis-kpi-container { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
							#mis-kpi-container .kpi-card { flex: 1 1 180px; min-width: 150px; border-radius: 10px; padding: 16px 18px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); box-sizing: border-box; min-height: 100px; }
							#mis-kpi-container .kpi-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
							#mis-kpi-container .kpi-icon { font-size: 20px; flex-shrink: 0; line-height: 1; }
							#mis-kpi-container .kpi-label { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Inter', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
							#mis-kpi-container .kpi-value { font-size: clamp(18px, 2.2vw, 24px); font-weight: 800; font-family: 'Inter', sans-serif; line-height: 1.2; word-break: break-word; }
							@media (max-width: 768px) { #mis-kpi-container .kpi-card { flex: 1 1 140px; min-width: 120px; padding: 12px 14px; min-height: 80px; } #mis-kpi-container .kpi-value { font-size: 16px; } }
							@media (max-width: 480px) { #mis-kpi-container .kpi-card { flex: 1 1 100%; min-width: unset; } }
						</style>
						${kpiCards.map(card => `<div class="kpi-card" style="background: ${card.bg}; border-left: 4px solid ${card.color};"><div class="kpi-card-header"><span class="kpi-icon">${card.icon}</span><span class="kpi-label">${card.label}</span></div><div class="kpi-value" style="color: ${card.color};">${card.value}</div></div>`).join('')}
					`);
				},
				refetchData: function (container, dashboardInstance) {
					const self = this;
					self.rawTableData = [];
					self.tableData = [];
					self.filterOptions = null;
					self.loadedUser = null;
					self.selectedMisZones = [];
					self.expandedZones = {};
					self.expandedRegions = {};
					self.expandedDistricts = {};
					self.checkedRows = {};
					self.searchTerm = "";
					self.allExpanded = false;
					dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
					self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
				},
				switchFormat: function (format, container, dashboardInstance) {
					const self = this;
					if (self.tableData && self.tableData.length > 0) {
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
					}
					self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
				},
				renderMisTable: function (tableContainer, dashboardInstance) {
					const self = this;
					self.renderAnalysisTable(tableContainer, dashboardInstance);
				},
				renderZoneFilterTags: function (container, dashboardInstance) {
					const self = this;
					if (!self.tableData || self.tableData.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					const permittedZones = (self.filterOptions && self.filterOptions.zones) || [];
					let zones = permittedZones.length > 0 ? permittedZones : [...new Set(self.tableData.map(r => r.zone).filter(Boolean))].sort();
					if (zones.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					const allSelected = self.selectedMisZones.length === 0;
					let html = '<span style="font-weight: 600; color: #475569; font-size: 13px; white-space: nowrap;">Zone:</span>';
					html += `<button class="mis-zone-filter-tag ${allSelected ? "active" : ""}" data-zone="all" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${allSelected ? "#417d81" : "#fff"}; color: ${allSelected ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">All</button>`;
					zones.forEach(zone => {
						const active = self.selectedMisZones.includes(zone);
						html += `<button class="mis-zone-filter-tag ${active ? "active" : ""}" data-zone="${zone}" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${active ? "#417d81" : "#fff"}; color: ${active ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">${zone}</button>`;
					});
					const $row = container.find("#mis-zone-filter-row");
					$row.html(html).css("display", "flex").css({ "align-items": "center", "gap": "8px", "flex-wrap": "wrap", "margin-bottom": "10px" });
					container.off("click", ".mis-zone-filter-tag").on("click", ".mis-zone-filter-tag", function () {
						const zone = $(this).data("zone");
						if (zone === "all") {
							self.selectedMisZones = [];
						} else {
							const idx = self.selectedMisZones.indexOf(zone);
							if (idx > -1) { self.selectedMisZones.splice(idx, 1); } else { self.selectedMisZones.push(zone); }
						}
						self.renderZoneFilterTags(container, dashboardInstance);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
				},
				aggregateByZone: function () {
					const self = this;
					let data = self.tableData || [];
					const term = (self.searchTerm || "").trim();
					if (term) {
						const terms = term.split(",").map(t => t.trim().toLowerCase()).filter(t => t);
						data = data.filter(row => {
							const br = (row.branch_name || row.sol_desc || "").toLowerCase();
							const id = (row.sol_id || "").toLowerCase();
							const dt = (row.district || "").toLowerCase();
							return terms.some(t => br.includes(t) || id.includes(t) || dt.includes(t));
						});
					}
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						data = data.filter(row => self.selectedMisZones.includes(row.zone));
					}
					const zoneMap = {};
					data.forEach(row => {
						const zone = row.zone || "Unknown";
						const region = row.region || "Unknown";
						const district = row.district || "Unknown";
						if (!zoneMap[zone]) {
							zoneMap[zone] = { zone, regions: {}, branches: [], total_accounts: 0, total_collection: 0, pending_accounts: 0, pending_amount: 0, pending_instalments: 0 };
						}
						if (!zoneMap[zone].regions[region]) {
							zoneMap[zone].regions[region] = { region, districts: {}, branches: [], total_accounts: 0, total_collection: 0, pending_accounts: 0, pending_amount: 0, pending_instalments: 0 };
						}
						if (!zoneMap[zone].regions[region].districts[district]) {
							zoneMap[zone].regions[region].districts[district] = { district, branches: [], total_accounts: 0, total_collection: 0, pending_accounts: 0, pending_amount: 0, pending_instalments: 0 };
						}
						zoneMap[zone].branches.push(row);
						zoneMap[zone].regions[region].branches.push(row);
						zoneMap[zone].regions[region].districts[district].branches.push(row);
						zoneMap[zone].total_accounts += row.total_accounts;
						zoneMap[zone].total_collection += row.total_collection;
						zoneMap[zone].pending_accounts += row.pending_accounts;
						zoneMap[zone].pending_amount += row.pending_amount;
						zoneMap[zone].pending_instalments += row.pending_instalments;
						zoneMap[zone].regions[region].total_accounts += row.total_accounts;
						zoneMap[zone].regions[region].total_collection += row.total_collection;
						zoneMap[zone].regions[region].pending_accounts += row.pending_accounts;
						zoneMap[zone].regions[region].pending_amount += row.pending_amount;
						zoneMap[zone].regions[region].pending_instalments += row.pending_instalments;
						zoneMap[zone].regions[region].districts[district].total_accounts += row.total_accounts;
						zoneMap[zone].regions[region].districts[district].total_collection += row.total_collection;
						zoneMap[zone].regions[region].districts[district].pending_accounts += row.pending_accounts;
						zoneMap[zone].regions[region].districts[district].pending_amount += row.pending_amount;
						zoneMap[zone].regions[region].districts[district].pending_instalments += row.pending_instalments;
					});
					const sortedZones = Object.keys(zoneMap).sort((a, b) => {
						const numA = parseInt(a.replace(/\D/g, "")) || 0;
						const numB = parseInt(b.replace(/\D/g, "")) || 0;
						return numA - numB;
					});
					const result = [];
					sortedZones.forEach(zoneName => {
						const zd = zoneMap[zoneName];
						const sortedRegions = Object.keys(zd.regions).sort((a, b) => {
							const numA = parseInt(a.replace(/\D/g, "")) || 0;
							const numB = parseInt(b.replace(/\D/g, "")) || 0;
							return numA - numB;
						});
						const regions = sortedRegions.map(rn => {
							const rd = zd.regions[rn];
							const sortedDistricts = Object.keys(rd.districts).sort();
							const districts = sortedDistricts.map(dn => rd.districts[dn]);
							return { region: rn, data: rd, districts };
						});
						result.push({ zone: zoneName, data: zd, regions });
					});
					return result;
				},
				renderAnalysisTable: function (tableContainer, dashboardInstance) {
					const self = this;
					const format = dashboardInstance.state.formatMode || "number";
					const fmtCount = (val) => {
						if (!val && val !== 0) return "0";
						if (format === "words") {
							if (val >= 10000000) return (val / 10000000).toFixed(2) + " Cr";
							if (val >= 100000) return (val / 100000).toFixed(2) + " L";
							if (val >= 1000) return (val / 1000).toFixed(2) + " K";
							return new Intl.NumberFormat("en-IN").format(val);
						}
						return new Intl.NumberFormat("en-IN").format(val);
					};
					const fmtAmt = (val) => {
						if (!val || val === 0) return "₹0";
						if (format === "words") {
							if (val >= 10000000) return "₹" + (val / 10000000).toFixed(2) + " Cr";
							if (val >= 100000) return "₹" + (val / 100000).toFixed(2) + " L";
							if (val >= 1000) return "₹" + (val / 1000).toFixed(2) + " K";
							return "₹" + new Intl.NumberFormat("en-IN").format(val);
						}
						return "₹" + new Intl.NumberFormat("en-IN").format(Math.round(val));
					};
					const zoneData = self.aggregateByZone();
					const totalFilteredBranches = zoneData.reduce((s, z) => s + z.data.branches.length, 0);
					const totalAllBranches = (self.tableData || []).length;
					const $badge = tableContainer.parent().find("#mis-records-count");
					$badge.text(totalFilteredBranches + " / " + totalAllBranches + " branches" + (self.searchTerm ? " (filtered)" : ""));
					if (totalFilteredBranches === totalAllBranches && !self.searchTerm) $badge.hide(); else $badge.show();
					if (!zoneData || zoneData.length === 0) {
						tableContainer.html('<div style="padding: 30px; text-align: center; color: #64748b; font-weight: 600; font-family: \'Inter\', sans-serif;">No data to display.</div>');
						return;
					}
					const grandTotal = { total_accounts: 0, total_collection: 0, pending_accounts: 0, pending_amount: 0, pending_instalments: 0 };
					zoneData.forEach(z => {
						grandTotal.total_accounts += z.data.total_accounts;
						grandTotal.total_collection += z.data.total_collection;
						grandTotal.pending_accounts += z.data.pending_accounts;
						grandTotal.pending_amount += z.data.pending_amount;
						grandTotal.pending_instalments += z.data.pending_instalments;
					});
					const metricCols = [
						{ key: "total_accounts", label: "Total Accounts", align: "right", fmt: fmtCount },
						{ key: "total_collection", label: "Total Collection", align: "right", fmt: fmtAmt },
						{ key: "pending_accounts", label: "Pending Accounts", align: "right", fmt: fmtCount },
						{ key: "pending_instalments", label: "Pending Instalments", align: "right", fmt: fmtCount },
						{ key: "pending_amount", label: "Pending Amount", align: "right", fmt: fmtAmt }
					];
					let sr = 0;
					let rowsHtml = "";
					zoneData.forEach(z => {
						sr++;
						const zoneExpanded = self.expandedZones[z.zone];
						const zoneRow = z.data;
						const zoneChecked = self.checkedRows["zone::" + z.zone];
						rowsHtml += `<tr class="mis-zone-row${zoneChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-check-id="zone::${z.zone}" style="cursor: pointer; background: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; width: 30px; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="zone::${z.zone}" ${zoneChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; width: 40px; font-size: 14px;">${sr}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; white-space: nowrap; font-size: 14px;"><span class="mis-zone-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #64748b;">${zoneExpanded ? "▼" : "▶"}</span>${z.zone}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px;">${zoneRow.branches.length}</td>
							${metricCols.map(mc => `<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: ${mc.align}; white-space: nowrap; font-size: 14px;">${mc.fmt(zoneRow[mc.key])}</td>`).join('')}
						</tr>`;
						z.regions.forEach(regionObj => {
							const region = regionObj.region;
							const regionKey = z.zone + "::" + region;
							const regionExpanded = self.expandedRegions[regionKey];
							const regionChecked = self.checkedRows[regionKey];
							rowsHtml += `<tr class="mis-region-row${regionChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-check-id="${regionKey}" style="display: ${zoneExpanded ? "table-row" : "none"}; cursor: pointer; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
								<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${regionKey}" ${regionChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
								<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
								<td style="padding: 8px 14px; color: #334155; white-space: nowrap; font-size: 14px; padding-left: 25px; font-weight: 600;"><span class="mis-region-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #94a3b8;">${regionExpanded ? "▼" : "▶"}</span>${region}</td>
								<td style="padding: 8px 14px; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${regionObj.data.branches.length}</td>
								${metricCols.map(mc => `<td style="padding: 8px 14px; color: #334155; text-align: ${mc.align}; white-space: nowrap; font-size: 14px; font-weight: 500;">${mc.fmt(regionObj.data[mc.key])}</td>`).join('')}
							</tr>`;
							regionObj.districts.forEach(districtObj => {
								const district = districtObj.district;
								const districtKey = z.zone + "::" + region + "::" + district;
								const districtExpanded = self.expandedDistricts[districtKey];
								const districtChecked = self.checkedRows[districtKey];
								const showDistrict = zoneExpanded && regionExpanded;
								rowsHtml += `<tr class="mis-district-row${districtChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-check-id="${districtKey}" style="display: ${showDistrict ? "table-row" : "none"}; cursor: pointer; background: #fafaf9; border-bottom: 1px solid #e7e5e4;">
									<td style="padding: 7px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${districtKey}" ${districtChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
									<td style="padding: 7px 14px; color: #78716c; text-align: center; white-space: nowrap; font-size: 14px;"></td>
									<td style="padding: 7px 14px; color: #44403c; white-space: nowrap; font-size: 14px; padding-left: 42px; font-weight: 600;"><span class="mis-district-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #a8a29e;">${districtExpanded ? "▼" : "▶"}</span>${district}</td>
									<td style="padding: 7px 14px; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${districtObj.branches.length}</td>
									${metricCols.map(mc => `<td style="padding: 7px 14px; color: #44403c; text-align: ${mc.align}; white-space: nowrap; font-size: 14px; font-weight: 500;">${mc.fmt(districtObj[mc.key])}</td>`).join('')}
								</tr>`;
								districtObj.branches.forEach((branch, bi) => {
									const showBranch = zoneExpanded && regionExpanded && districtExpanded;
									const branchBg = bi % 2 === 0 ? "#ffffff" : "#f1f5f9";
									const solId = branch.sol_id || "branch_" + bi;
									const branchChecked = self.checkedRows[solId];
									rowsHtml += `<tr class="mis-branch-row${branchChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-check-id="${solId}" style="display: ${showBranch ? "table-row" : "none"}; background: ${branchBg}; border-bottom: 1px solid #e2e8f0;">
										<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${solId}" ${branchChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
										<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
										<td style="padding: 6px 14px; color: #475569; white-space: nowrap; font-size: 14px; padding-left: 60px; font-weight: 500;">${branch.sol_id} - ${branch.branch_name || branch.sol_desc}</td>
										<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">1</td>
										${metricCols.map(mc => `<td style="padding: 6px 14px; color: #475569; text-align: ${mc.align}; white-space: nowrap; font-size: 14px; font-weight: 500;">${mc.fmt(branch[mc.key])}</td>`).join('')}
									</tr>`;
								});
							});
						});
					});
					const tableHtml = `
						<style>
							#mis-analysis-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
							#mis-analysis-table thead { position: sticky; top: 0; z-index: 2; }
							#mis-analysis-table tfoot { position: sticky; bottom: 0; z-index: 2; }
							#mis-analysis-table tfoot tr { box-shadow: 0 -2px 6px rgba(0,0,0,0.1); }
							#mis-analysis-table tbody tr { transition: background-color 0.2s ease; border-bottom: 1px solid #e2e8f0; }
							#mis-analysis-table tbody tr:hover { background: #dcfce7 !important; }
							#mis-analysis-table tbody tr.mis-row-checked { background: #bbf7d0 !important; }
							#mis-analysis-table tbody tr.mis-zone-row.mis-row-checked,
							#mis-analysis-table tbody tr.mis-region-row.mis-row-checked,
							#mis-analysis-table tbody tr.mis-district-row.mis-row-checked,
							#mis-analysis-table tbody tr.mis-branch-row.mis-row-checked { background: #86efac !important; }
							#mis-scroll-area { max-height: 550px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
						</style>
						<div id="mis-scroll-area">
							<table id="mis-analysis-table">
								<thead><tr style="background: linear-gradient(180deg, #3d7579 0%, #346569 100%); color: #ffffff;">
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 30px;"><input type="checkbox" class="mis-check-all" style="cursor: pointer; width: 14px; height: 14px;"></th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 40px;">Sr</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap;">Z / R / D / SOL Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap;">Branches</th>
									${metricCols.map(mc => `<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: ${mc.align}; white-space: nowrap;">${mc.label}</th>`).join('')}
								</tr></thead>
								<tbody>${rowsHtml}</tbody>
								<tfoot><tr style="background: #1e293b; color: #ffffff; font-weight: 700;">
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: left; white-space: nowrap; font-size: 14px;">TOTAL</td>
									<td style="padding: 10px 12px; text-align: center; white-space: nowrap; font-size: 14px;">${zoneData.reduce((s, z) => s + z.data.branches.length, 0)}</td>
									${metricCols.map(mc => `<td style="padding: 10px 12px; text-align: ${mc.align}; white-space: nowrap; font-size: 14px;">${mc.fmt(grandTotal[mc.key])}</td>`).join('')}
								</tr></tfoot>
							</table>
						</div>`;
					tableContainer.html(tableHtml);
					tableContainer.off("click", ".mis-zone-row").on("click", ".mis-zone-row", function (e) {
						if ($(e.target).closest(".mis-region-toggle, .mis-region-row, .mis-district-row, input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						self.expandedZones[zone] = !self.expandedZones[zone];
						const show = self.expandedZones[zone];
						const $regionRows = tableContainer.find(`.mis-region-row[data-zone="${zone}"]`);
						const $districtRows = tableContainer.find(`.mis-district-row[data-zone="${zone}"]`);
						const $branchRows = tableContainer.find(`.mis-branch-row[data-zone="${zone}"]`);
						if (show) {
							$regionRows.stop(true, true).slideDown(200);
							$regionRows.each(function () {
								const r = $(this).data("region");
								if (self.expandedRegions[zone + "::" + r]) {
									tableContainer.find(`.mis-district-row[data-zone="${zone}"][data-region="${r}"]`).stop(true, true).slideDown(200);
									$districtRows.each(function () {
										const d = $(this).data("district");
										if (self.expandedDistricts[zone + "::" + r + "::" + d]) {
											tableContainer.find(`.mis-branch-row[data-zone="${zone}"][data-region="${r}"][data-district="${d}"]`).stop(true, true).slideDown(200);
										}
									});
								}
							});
						} else {
							$branchRows.stop(true, true).slideUp(150);
							$districtRows.stop(true, true).slideUp(150);
							$regionRows.stop(true, true).slideUp(200);
						}
						$(this).find(".mis-zone-toggle").text(show ? "▼" : "▶");
					});
					tableContainer.off("click", ".mis-region-row").on("click", ".mis-region-row", function (e) {
						if ($(e.target).closest(".mis-district-toggle, .mis-district-row, input[type=checkbox]").length) return;
						e.stopPropagation();
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const regionKey = zone + "::" + region;
						self.expandedRegions[regionKey] = !self.expandedRegions[regionKey];
						const show = self.expandedRegions[regionKey];
						const $districtRows = tableContainer.find(`.mis-district-row[data-zone="${zone}"][data-region="${region}"]`);
						const $branchRows = tableContainer.find(`.mis-branch-row[data-zone="${zone}"][data-region="${region}"]`);
						if (show) {
							$districtRows.stop(true, true).slideDown(200);
							$districtRows.each(function () {
								const d = $(this).data("district");
								if (self.expandedDistricts[zone + "::" + region + "::" + d]) {
									tableContainer.find(`.mis-branch-row[data-zone="${zone}"][data-region="${region}"][data-district="${d}"]`).stop(true, true).slideDown(200);
								}
							});
						} else {
							$branchRows.stop(true, true).slideUp(150);
							$districtRows.stop(true, true).slideUp(150);
						}
						$(this).find(".mis-region-toggle").text(show ? "▼" : "▶");
					});
					tableContainer.off("click", ".mis-district-row").on("click", ".mis-district-row", function (e) {
						if ($(e.target).is("input[type=checkbox]")) return;
						e.stopPropagation();
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const districtKey = zone + "::" + region + "::" + district;
						self.expandedDistricts[districtKey] = !self.expandedDistricts[districtKey];
						const show = self.expandedDistricts[districtKey];
						const $branchRows = tableContainer.find(`.mis-branch-row[data-zone="${zone}"][data-region="${region}"][data-district="${district}"]`);
						if (show) { $branchRows.stop(true, true).slideDown(200); } else { $branchRows.stop(true, true).slideUp(150); }
						$(this).find(".mis-district-toggle").text(show ? "▼" : "▶");
					});
					tableContainer.off("change", ".mis-row-check").on("change", ".mis-row-check", function () {
						const checkId = $(this).data("check-id");
						const checked = $(this).prop("checked");
						self.checkedRows[checkId] = checked;
						$(this).closest("tr").toggleClass("mis-row-checked", checked);
					});
					tableContainer.off("change", ".mis-check-all").on("change", ".mis-check-all", function () {
						const checked = $(this).prop("checked");
						tableContainer.find(".mis-row-check").each(function () {
							$(this).prop("checked", checked).trigger("change");
						});
					});
				},
			},
			{
				id: "daily_ch_report",
				name: "Daily CH Report",
				type: "group",
				children: ["daily_account_opening", "gl_wise_ch_report"]
			},
			{
				id: "daily_account_opening",
				name: "Daily Account Opening",
				tableData: [],
				filterOptions: null,
				expandedZones: {},
				expandedRegions: {},
				checkedRows: {},
				searchTerm: "",
				allExpanded: false,
				selectedMisZones: [],
				render: function (container, dashboardInstance, seq) {
					const self = this;
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<input type="text" id="mis-search" placeholder="Search branch or SOL ID..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 200px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="mis-expand-toggle" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">▼ Expand All</button>
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
								<span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
								<div class="btn-group mis-format-toggle" role="group">
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
								</div>
							</div>
							<div style="font-size: 13px; font-weight: 700; color: #417d81; background: rgba(65,125,129,0.08); padding: 6px 12px; border-radius: 6px;" id="mis-records-count"></div>
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							${dashboardInstance.buildMisSkeletonTable("Fetching latest Daily Account Opening data...")}
						</div>
						<div id="mis-zone-filter-row" style="display: none; margin-bottom: 10px;"></div>
						<div id="mis-kpi-container" ${self.tableData && self.tableData.length ? "" : 'style="display: none;"'}></div>
						<div id="mis-table-container" ${self.tableData ? "" : 'style="display: none;"'}></div>
					`);

					if (self.tableData && self.tableData.length > 0) {
						self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
						container.find("#mis-records-count").text(`${self.tableData.length} records`);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
						container.find("#mis-controls, #mis-table-container, #mis-kpi-container").show();
						container.find("#mis-loading").hide();
						self.attachReportEventHandlers(container, dashboardInstance);
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_mis_filter_options",
						callback: function (r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							if (r.message) {
								self.filterOptions = r.message;
								console.log("DEBUG: API CALL get_daily_account_opening_data START", { selected_date: dashboardInstance.state.selectedDate });
								frappe.call({
									method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_daily_account_opening_data",
									args: { selected_date: dashboardInstance.state.selectedDate },
									callback: function (r3) {
										console.log("DEBUG: API CALL get_daily_account_opening_data RESPONSE", r3.message);
										if (dashboardInstance._misRenderSeq !== seq) return;
										if (r3.message) {
											self.tableData = r3.message;
											self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
											container.find("#mis-records-count").text(`${r3.message.length} records`);
											self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
											self.renderZoneFilterTags(container, dashboardInstance);
										}
										container.find("#mis-loading").hide();
										container.find("#mis-controls, #mis-table-container, #mis-kpi-container, #mis-zone-filter-row").show();
									}
								});
							}
						}
					});
					self.attachReportEventHandlers(container, dashboardInstance);
				},
				renderKPI: function (container, dashboardInstance) {
					const self = this;
					const data = self.tableData || [];
					let totSA = 0, totCA = 0, totTASC = 0, totRD = 0, totSMBG = 0, totDD = 0, totFD = 0, totAll = 0;
					data.forEach(r => {
						totSA += r.sa || 0; totCA += r.ca || 0; totTASC += r.tasc || 0; totRD += r.rd || 0;
						totSMBG += r.smbg || 0; totDD += r.dd || 0; totFD += r.fd || 0; totAll += r.total || 0;
					});
					container.html(`
						<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 16px;">
							${[
								{ l: "SA Accounts", v: totSA }, { l: "CA Accounts", v: totCA }, { l: "TASC Accounts", v: totTASC },
								{ l: "RD Accounts", v: totRD }, { l: "SMBG Accounts", v: totSMBG }, { l: "DD Accounts", v: totDD },
								{ l: "FD Accounts", v: totFD }
							].map(c => `<div style="padding: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; text-align: center;"><div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">${c.l}</div><div style="font-size: 20px; font-weight: 800; color: #417d81; margin-top: 4px;">${new Intl.NumberFormat("en-IN").format(c.v)}</div></div>`).join('')}
							<div style="padding: 12px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; text-align: center;"><div style="font-size: 11px; font-weight: 700; color: #166534; text-transform: uppercase;">Total Opened</div><div style="font-size: 20px; font-weight: 800; color: #15803d; margin-top: 4px;">${new Intl.NumberFormat("en-IN").format(totAll)}</div></div>
						</div>
					`);
					container.show();
				},
				renderMisTable: function (tableContainer, dashboardInstance) {
					this.renderAnalysisTable(tableContainer, dashboardInstance);
				},
				renderAnalysisTable: function (tableContainer, dashboardInstance) {
					const self = this;
					let data = self.tableData || [];
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						data = data.filter(r => self.selectedMisZones.includes(r.zone));
					}
					if (self.searchTerm) {
						const term = self.searchTerm.toLowerCase();
						data = data.filter(r => (r.branch_name || "").toLowerCase().includes(term) || (r.sol_id || "").toLowerCase().includes(term));
					}
					const metricCols = [
						{ key: "sa", label: "SA ACCOUNTS" },
						{ key: "ca", label: "CA ACCOUNTS" },
						{ key: "tasc", label: "TASC ACCOUNTS" },
						{ key: "rd", label: "RD ACCOUNTS" },
						{ key: "smbg", label: "SMBG ACCOUNTS" },
						{ key: "dd", label: "DD ACCOUNTS" },
						{ key: "fd", label: "FD ACCOUNTS" },
						{ key: "total", label: "TOTAL OPENED", style: "color: #15803d; font-weight: 800;" }
					];
					dashboardInstance.renderGeneric4LevelTreeTable(
						tableContainer,
						self,
						data,
						metricCols,
						"Daily Account Opening"
					);
				},
				renderZoneFilterTags: function (container, dashboardInstance) {
					const self = this;
					if (!self.tableData || self.tableData.length === 0) { container.find("#mis-zone-filter-row").hide(); return; }
					const permittedZones = (self.filterOptions && self.filterOptions.zones) || [];
					let zones = permittedZones.length > 0 ? permittedZones : [...new Set(self.tableData.map(r => r.zone).filter(Boolean))].sort();
					if (zones.length === 0) { container.find("#mis-zone-filter-row").hide(); return; }
					const allSelected = self.selectedMisZones.length === 0;
					let html = '<span style="font-weight: 600; color: #475569; font-size: 13px; white-space: nowrap;">Zone:</span>';
					html += `<button class="mis-zone-filter-tag ${allSelected ? "active" : ""}" data-zone="all" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${allSelected ? "#417d81" : "#fff"}; color: ${allSelected ? "#fff" : "#475569"}; cursor: pointer;">All</button>`;
					zones.forEach(zone => {
						const active = self.selectedMisZones.includes(zone);
						html += `<button class="mis-zone-filter-tag ${active ? "active" : ""}" data-zone="${zone}" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${active ? "#417d81" : "#fff"}; color: ${active ? "#fff" : "#475569"}; cursor: pointer;">${zone}</button>`;
					});
					const $row = container.find("#mis-zone-filter-row");
					$row.html(html).css("display", "flex").css({ "align-items": "center", "gap": "8px", "flex-wrap": "wrap", "margin-bottom": "10px" });
					container.off("click", ".mis-zone-filter-tag").on("click", ".mis-zone-filter-tag", function () {
						const zone = $(this).data("zone");
						if (zone === "all") { self.selectedMisZones = []; }
						else { const idx = self.selectedMisZones.indexOf(zone); if (idx > -1) { self.selectedMisZones.splice(idx, 1); } else { self.selectedMisZones.push(zone); } }
						self.renderZoneFilterTags(container, dashboardInstance);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
				},
				aggregateByZone: function () {
					const self = this;
					const data = self.tableData || [];
					let filtered = data;
					const term = (self.searchTerm || "").trim().toLowerCase();
					if (term) {
						filtered = data.filter(r => {
							const br = (r.branch_name || "").toLowerCase();
							const sid = (r.sol_id || "").toLowerCase();
							return br.includes(term) || sid.includes(term);
						});
					}
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						filtered = filtered.filter(r => self.selectedMisZones.includes(r.zone));
					}
					const zones = {};
					filtered.forEach(r => {
						const zName = r.zone || "Unknown Zone";
						const rName = r.region || "Unknown Region";
						const solId = r.sol_id;
						if (!zones[zName]) { zones[zName] = { zone: zName, data: { branches: new Set(), ca: 0, sa: 0, tasc: 0, rd: 0, smbg: 0, dd: 0, fd: 0, total: 0 }, regions: {} }; }
						if (!zones[zName].regions[rName]) { zones[zName].regions[rName] = { region: rName, branches: {} }; }
						if (!zones[zName].regions[rName].branches[solId]) {
							zones[zName].regions[rName].branches[solId] = { sol_id: solId, branch_name: r.branch_name || ("Branch " + solId), ca: r.ca || 0, sa: r.sa || 0, tasc: r.tasc || 0, rd: r.rd || 0, smbg: r.smbg || 0, dd: r.dd || 0, fd: r.fd || 0, total: r.total || 0 };
						}
						zones[zName].data.branches.add(solId);
						zones[zName].data.ca += r.ca || 0; zones[zName].data.sa += r.sa || 0; zones[zName].data.tasc += r.tasc || 0;
						zones[zName].data.rd += r.rd || 0; zones[zName].data.smbg += r.smbg || 0; zones[zName].data.dd += r.dd || 0;
						zones[zName].data.fd += r.fd || 0; zones[zName].data.total += r.total || 0;
					});
					return Object.values(zones).map(z => {
						const regionsArr = Object.values(z.regions).map(reg => {
							const branchesArr = Object.values(reg.branches);
							return { region: reg.region, branches: branchesArr, ca: branchesArr.reduce((s, b) => s + b.ca, 0), sa: branchesArr.reduce((s, b) => s + b.sa, 0), tasc: branchesArr.reduce((s, b) => s + b.tasc, 0), rd: branchesArr.reduce((s, b) => s + b.rd, 0), smbg: branchesArr.reduce((s, b) => s + b.smbg, 0), dd: branchesArr.reduce((s, b) => s + b.dd, 0), fd: branchesArr.reduce((s, b) => s + b.fd, 0), total: branchesArr.reduce((s, b) => s + b.total, 0) };
						});
						z.data.branches = Array.from(z.data.branches);
						z.regions = regionsArr;
						return z;
					}).sort((a, b) => a.zone.localeCompare(b.zone));
				},
				attachReportEventHandlers: function (container, dashboardInstance) {
					const self = this;
					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").each(function () {
							const btn = $(this);
							const isActive = btn.data("format") === format;
							btn.css("background", isActive ? "#417d81" : "#e2e8f0");
							btn.css("color", isActive ? "white" : "#475569");
						});
						if (self.tableData && self.tableData.length > 0) {
							self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
							self.renderZoneFilterTags(container, dashboardInstance);
						}
						self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
					});
					let searchTimeout;
					container.off("input", "#mis-search").on("input", "#mis-search", function () {
						clearTimeout(searchTimeout);
						searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (self.tableData) { self.renderMisTable(container.find("#mis-table-container"), dashboardInstance); }
						}, 300);
					});
					container.off("click", "#mis-expand-toggle").on("click", "#mis-expand-toggle", function () {
						self.allExpanded = !self.allExpanded;
						const expand = self.allExpanded;
						if (!self.tableData) return;
						const zoneData = self.aggregateByZone();
						zoneData.forEach(z => {
							self.expandedZones[z.zone] = expand;
							z.regions.forEach(r => { self.expandedRegions[z.zone + "::" + r.region] = expand; });
						});
						$(this).text(expand ? "▲ Collapse All" : "▼ Expand All");
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.tableData = []; self.filterOptions = null; self.selectedMisZones = [];
						self.expandedZones = {}; self.expandedRegions = {}; self.checkedRows = {};
						self.searchTerm = ""; self.allExpanded = false;
						dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
						self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
					});
				},
			},
			{
				id: "casa_daily_report",
				name: "CASA Daily Report",
				type: "group",
				children: ["ntb_evr", "cust_wise_avg_bal"]
			},
			{
				id: "ntb_evr",
				name: "CASA NTB & EVR",
				tableData: [],
				expandedZones: {},
				expandedRegions: {},
				render: function (container, dashboardInstance) {
					const self = this;
					container.html(`
						<style>
							#ntb-evr-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
							#ntb-evr-table thead th { background: linear-gradient(180deg, #3d7579 0%, #346569 100%); color: #ffffff; padding: 10px 14px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; border-bottom: 1px solid #cbd5e1; }
							#ntb-evr-table thead th:first-child { border-radius: 6px 0 0 0; }
							#ntb-evr-table thead th:last-child { border-radius: 0 6px 0 0; }
							#ntb-evr-table tbody td { padding: 10px 14px; font-size: 14px; color: #334155; border-bottom: 1px solid #e2e8f0; }
							#ntb-evr-table tbody tr { transition: background-color 0.2s ease; }
							#ntb-evr-table tbody tr:hover { background: #dcfce7 !important; }
							#ntb-evr-table tfoot td { padding: 10px 14px; font-size: 14px; font-weight: 700; color: #ffffff; background: #1e293b; }
							#ntb-evr-scroll { max-height: 550px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
						</style>
						<div id="ntb-evr-loading" style="width: 100%; margin-top: 10px;">
							${dashboardInstance.buildMisSkeletonTable("Fetching CASA NTB & EVR data...")}
						</div>
						<div id="ntb-evr-table-container"></div>
					`);

					const renderTable = (data) => {
						const metricCols = [
							{ key: "ntb", label: "NTB" },
							{ key: "evr", label: "EVR" },
							{ key: "total", label: "TOTAL ACCOUNTS", calc: (r) => (r.ntb || 0) + (r.evr || 0) }
						];
						dashboardInstance.renderGeneric4LevelTreeTable(
							container.find("#ntb-evr-table-container"),
							self,
							data,
							metricCols,
							"CASA NTB & EVR"
						);
					};

					const fetchData = () => {
					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_ntb_evr_data",
						args: { selected_date: dashboardInstance.state.selectedDate },
						callback: function (r) {
							if (r.message && r.message.data) {
								self.tableData = r.message.data;
								self.totalRows = r.message.total_rows || 0;
								renderTable(self.tableData);
							} else {
								container.find("#ntb-evr-table-container").html('<div style="padding: 30px; text-align: center; color: #94a3b8; font-weight: 600;">No data available</div>');
							}
							container.find("#ntb-evr-loading").hide();
						}
					});
					};

					if (self.tableData && self.tableData.length > 0) {
						container.find("#ntb-evr-loading").hide();
						renderTable(self.tableData);
					} else {
						fetchData();
					}
				},
			},
			{
				id: "cust_wise_avg_bal",
				name: "CASA Cust Wise AVG Bal",
				currentPage: 1,
				pageSize: 5000,
				totalPages: 0,
				totalRows: 0,
				cachedPages: {},
				cacheDate: null,
				searchTerm: "",
				_bgRunning: false,
				_renderSeq: 0,
				render: function (container, dashboardInstance) {
					const self = this;
					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const columns = [
						{ key: "cif_id", label: "CIF ID", w: "100px", sticky: 1 },
						{ key: "acct_name", label: "Acct Name", w: "160px", sticky: 2 },
						{ key: "foracid", label: "Foracid", w: "120px", sticky: 3 },
						{ key: "acct_opn_date", label: "Acct Open Date", w: "100px" },
						{ key: "schm_code", label: "Schema", w: "80px" },
						{ key: "sol_id", label: "SOL ID", w: "80px" },
						{ key: "sol_desc", label: "Branch", w: "140px" },
						{ key: "cif_id_opening_date", label: "CIF Open Date", w: "100px" },
						{ key: "cif_status", label: "CIF Status", w: "80px" },
						{ key: "tran_date_bal", label: "Tran Date Bal", w: "110px", fmt: fmtAmt },
						{ key: "clr_bal_amt", label: "CLR Bal Amt", w: "110px", fmt: fmtAmt },
						{ key: "total_weighted_balance", label: "Total Weighted Bal", w: "130px", fmt: fmtAmt },
						{ key: "total_days", label: "Total Days", w: "80px" },
						{ key: "average_balance", label: "Avg Balance", w: "110px", fmt: fmtAmt },
						{ key: "closing_mab", label: "Closing MAB", w: "110px", fmt: fmtAmt },
						{ key: "opening_mab", label: "Opening MAB", w: "110px", fmt: fmtAmt },
						{ key: "inc_mab", label: "Inc MAB", w: "100px", fmt: fmtAmt },
						{ key: "status", label: "Status", w: "70px" },
						{ key: "rm_id", label: "RM ID", w: "80px" },
						{ key: "emp_name", label: "Emp Name", w: "120px" },
						{ key: "division_name", label: "Division", w: "100px" },
						{ key: "region_name", label: "Region", w: "100px" },
						{ key: "circle_office_name", label: "ZONE", w: "110px" },
					];

					container.html(`
						<style>
							#cavg-scroll { max-height: 550px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
							#cavg-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; white-space: nowrap; }
							#cavg-table thead th { position: sticky; top: 0; z-index: 2; background: linear-gradient(180deg, #3d7579 0%, #346569 100%); color: #fff; padding: 8px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; border-bottom: 1px solid #cbd5e1; box-sizing: border-box; }
							.cavg-resizer { position: absolute; right: 0; top: 0; bottom: 0; width: 6px; cursor: col-resize; user-select: none; z-index: 10; }
							.cavg-resizer:hover, .cavg-resizer.resizing { background: #86efac; opacity: 0.9; }
							#cavg-table thead th.cavg-sticky { position: sticky; z-index: 3; background: #346569; overflow: hidden; }
							#cavg-table tbody td { padding: 7px 10px; font-size: 12px; color: #334155; border-bottom: 1px solid #e2e8f0; }
							#cavg-table tbody td.cavg-sticky { position: sticky; z-index: 1; overflow: hidden; }
							#cavg-table tbody tr:nth-child(even) td.cavg-sticky { background: #f8fafc; }
							#cavg-table tbody tr:nth-child(odd) td.cavg-sticky { background: #fff; }
							#cavg-table tbody tr:hover td.cavg-sticky { background: #dcfce7 !important; }
							#cavg-table tbody tr:hover td:not(.cavg-sticky) { background: #dcfce7 !important; }
							.cavg-page-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; height: 32px; padding: 0 8px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; color: #475569; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
							.cavg-page-btn:hover:not(.cavg-active):not(:disabled) { background: #f1f5f9; border-color: #94a3b8; }
							.cavg-page-btn.cavg-active { background: #417d81; color: #fff; border-color: #417d81; cursor: default; }
							.cavg-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
							.cavg-page-btn.cfg-loaded { background: #f0fdf4; border-color: #86efac; color: #166534; }
							.cavg-page-btn.cfg-loaded:hover:not(.cavg-active) { background: #dcfce7; }
						</style>
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="cavg-controls">
							<input type="text" id="cavg-search" placeholder="Search account, CIF, branch..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 220px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="cavg-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="font-size: 13px; font-weight: 700; color: #417d81; background: rgba(65,125,129,0.08); padding: 6px 12px; border-radius: 6px; margin-left: auto;" id="cavg-count"></div>
						</div>
						<div id="cavg-loading" style="width: 100%; margin-top: 10px;">
							${dashboardInstance.buildMisSkeletonTable("Loading page 1...")}
						</div>
						<div id="cavg-table-container" style="display: none;"></div>
						<div id="cavg-pagination" style="display: none; align-items: center; gap: 6px; margin-top: 12px; font-family: 'Inter', sans-serif; flex-wrap: wrap;"></div>
					`);

					const buildRowHtml = (r) => {
						let html = "<tr>";
						columns.forEach(c => {
							const val = r[c.key];
							const display = c.fmt ? c.fmt(val) : (val !== null && val !== undefined ? val : "-");
							const stickyClass = c.sticky ? ` cavg-sticky cavg-sticky-${c.sticky}` : "";
							const wStyle = c.sticky
								? ` style="width:${c.w}; min-width:${c.w}; max-width:${c.w}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"`
								: "";
							const titleAttr = (c.key === "acct_name" || c.key === "cif_id" || c.key === "foracid")
								? ` title="${frappe.utils.escape_html(String(display))}"`
								: "";
							html += `<td class="${stickyClass}"${wStyle}${titleAttr}>${display}</td>`;
						});
						return html + "</tr>";
					};

					const initColumnResizers = () => {
						container.off("mousedown", ".cavg-resizer").on("mousedown", ".cavg-resizer", function (e) {
							e.preventDefault();
							e.stopPropagation();
							const $resizer = $(this);
							const $th = $resizer.closest("th");
							const startX = e.pageX;
							const startWidth = $th.outerWidth();
							const colIdx = $th.index();
							const $table = container.find("#cavg-table");
							$resizer.addClass("resizing");
							$("body").css("cursor", "col-resize");

							$(document).on("mousemove.cavgResize", function (evt) {
								const diff = evt.pageX - startX;
								const newWidth = Math.max(40, startWidth + diff);
								$th.css({ "width": newWidth + "px", "min-width": newWidth + "px", "max-width": newWidth + "px" });
								$table.find(`tbody tr td:nth-child(${colIdx + 1})`).css({ "width": newWidth + "px", "min-width": newWidth + "px", "max-width": newWidth + "px" });
								if (!self._stickyThrottle) {
									self._stickyThrottle = requestAnimationFrame(() => {
										applyStickyLeft();
										self._stickyThrottle = null;
									});
								}
							});

							$(document).on("mouseup.cavgResize", function () {
								$(document).off("mousemove.cavgResize mouseup.cavgResize");
								$resizer.removeClass("resizing");
								$("body").css("cursor", "");
							});
						});
					};

					const initTable = () => {
						container.find("#cavg-table-container").html(`
							<div id="cavg-scroll">
								<table id="cavg-table">
									<thead><tr>
										${columns.map(c => {
											const stickyClass = c.sticky ? ` cavg-sticky cavg-sticky-${c.sticky}` : "";
											const wStyle = c.sticky ? `width: ${c.w}; min-width: ${c.w}; max-width: ${c.w}; overflow:hidden; text-overflow:ellipsis;` : `min-width: ${c.w};`;
											return `<th class="${stickyClass}" style="${wStyle}">
												<span>${c.label}</span>
												<div class="cavg-resizer"></div>
											</th>`;
										}).join("")}
									</tr></thead>
									<tbody id="cavg-tbody"></tbody>
								</table>
							</div>
						`);
						initColumnResizers();
					};

					const applyStickyLeft = () => {
						const table = container.find("#cavg-table")[0];
						if (!table) return;
						const ths = table.querySelectorAll("thead th");
						let cumulativeLeft = 0;
						const stickyCols = columns.filter(c => c.sticky);
						stickyCols.forEach((c, i) => {
							const th = ths[i];
							if (!th) return;
							const colWidth = th.offsetWidth;
							const cssProp = `--cavg-sticky-${c.sticky}`;
							table.style.setProperty(cssProp, cumulativeLeft + "px");
							cumulativeLeft += colWidth;
						});
						const styleId = "cavg-dynamic-sticky";
						let styleEl = document.getElementById(styleId);
						const s1 = table.style.getPropertyValue("--cavg-sticky-1") || "0px";
						const s2 = table.style.getPropertyValue("--cavg-sticky-2") || "100px";
						const s3 = table.style.getPropertyValue("--cavg-sticky-3") || "250px";
						const css = `
							#cavg-table thead th.cavg-sticky-1 { left: ${s1}; }
							#cavg-table thead th.cavg-sticky-2 { left: ${s2}; }
							#cavg-table thead th.cavg-sticky-3 { left: ${s3}; }
							#cavg-table tbody td.cavg-sticky-1 { left: ${s1}; }
							#cavg-table tbody td.cavg-sticky-2 { left: ${s2}; }
							#cavg-table tbody td.cavg-sticky-3 { left: ${s3}; }
						`;
						if (!styleEl) {
							styleEl = document.createElement("style");
							styleEl.id = styleId;
							document.head.appendChild(styleEl);
						}
						styleEl.textContent = css;
					};

					let _renderChunkRaf = null;
					const appendRows = (data) => {
						const $tbody = container.find("#cavg-tbody");
						if (_renderChunkRaf) cancelAnimationFrame(_renderChunkRaf);

						if (!data || data.length === 0) {
							$tbody.html('<tr><td colspan="23" style="text-align:center; padding: 20px; color: #64748b;">No matching records found</td></tr>');
							return;
						}

						// 1. Instantly render the first 100 rows (takes ~2-5ms)
						const firstBatch = data.slice(0, 100);
						$tbody.html(firstBatch.map(r => buildRowHtml(r)).join(""));

						// 2. Stream remaining rows in non-blocking chunks using requestAnimationFrame
						if (data.length > 100) {
							let offset = 100;
							const chunkSize = 200;
							const renderChunk = () => {
								if (offset >= data.length) return;
								const chunk = data.slice(offset, offset + chunkSize);
								$tbody.append(chunk.map(r => buildRowHtml(r)).join(""));
								offset += chunkSize;
								if (offset < data.length) {
									_renderChunkRaf = requestAnimationFrame(renderChunk);
								}
							};
							_renderChunkRaf = requestAnimationFrame(renderChunk);
						}
					};

					const updateCount = () => {
						let totalLoaded = 0;
						Object.keys(self.cachedPages).forEach(p => {
							if (self.cachedPages[p] && Array.isArray(self.cachedPages[p])) {
								totalLoaded += self.cachedPages[p].length;
							}
						});



						if (self.searchTerm) {
							const pageData = self.cachedPages[self.currentPage] || [];
							const filteredCount = pageData.filter(r =>
								Object.values(r).some(v => v !== null && String(v).toLowerCase().includes(self.searchTerm))
							).length;
							container.find("#cavg-count").text(`${filteredCount.toLocaleString()} matching records (Page ${self.currentPage})`);
							return;
						}

						if (self.totalRows > 0) {
							container.find("#cavg-count").text(`${Math.min(totalLoaded, self.totalRows).toLocaleString()} / ${self.totalRows.toLocaleString()} records loaded`);
						} else if (totalLoaded > 0) {
							container.find("#cavg-count").text(`${totalLoaded.toLocaleString()} records loaded`);
						} else {
							container.find("#cavg-count").text("0 records");
						}
					};

					const renderPaginationBar = () => {
						const $bar = container.find("#cavg-pagination");

						if (self.totalRows > 0) {
							self.totalPages = Math.ceil(self.totalRows / self.pageSize);
						}
						const hasFullPage = self.cachedPages[self.currentPage] && self.cachedPages[self.currentPage].length >= self.pageSize;
						const effectiveTotalPages = Math.max(self.totalPages || 1, hasFullPage ? self.currentPage + 1 : 1);

						if (effectiveTotalPages <= 1) { $bar.hide(); return; }
						$bar.show();

						let html = "";
						html += `<button class="cavg-page-btn" id="cavg-prev" ${self.currentPage <= 1 ? 'disabled' : ''}>◀ Prev</button>`;

						const pages = [];
						if (effectiveTotalPages <= 7) {
							for (let i = 1; i <= effectiveTotalPages; i++) pages.push(i);
						} else {
							pages.push(1);
							if (self.currentPage > 3) pages.push("...");
							const start = Math.max(2, self.currentPage - 1);
							const end = Math.min(effectiveTotalPages - 1, self.currentPage + 1);
							for (let i = start; i <= end; i++) pages.push(i);
							if (self.currentPage < effectiveTotalPages - 2) pages.push("...");
							pages.push(effectiveTotalPages);
						}

						pages.forEach(p => {
							if (p === "...") {
								html += `<span style="display:inline-flex;align-items:center;min-width:24px;height:32px;color:#94a3b8;font-size:13px;">…</span>`;
							} else {
								const active = p === self.currentPage ? " cavg-active" : "";
								const loaded = self.cachedPages[p] ? " cfg-loaded" : "";
								html += `<button class="cavg-page-btn${active}${loaded}" data-page="${p}">${p}</button>`;
							}
						});

						html += `<button class="cavg-page-btn" id="cavg-next" ${self.currentPage >= effectiveTotalPages ? 'disabled' : ''}>Next ▶</button>`;
						$bar.html(html);
					};

					const renderPage = () => {
						initTable();
						const pageData = self.cachedPages[self.currentPage] || [];
						const filtered = self.searchTerm
							? pageData.filter(r => Object.values(r).some(v => v !== null && String(v).toLowerCase().includes(self.searchTerm)))
							: pageData;
						appendRows(filtered);
						applyStickyLeft();
						updateCount();
						renderPaginationBar();
					};

					// Invalidate cache if date changed
					if (self.cacheDate && self.cacheDate !== (dashboardInstance.state.selectedDate || frappe.datetime.get_today())) {
						self.cachedPages = {};
						self.cacheDate = null;
						self.currentPage = 1;
						self.totalRows = 0;
						self.totalPages = 0;
						self._bgRunning = false;
					}

					const fetchPageAjax = (pageNum) => {
						return new Promise((resolve) => {
							const selDate = dashboardInstance.state.selectedDate || frappe.datetime.get_today();

							// Check memory cache
							if (self.cachedPages[pageNum] && self.cacheDate === selDate) {
								resolve(true);
								return;
							}

							// Check sessionStorage cache fallback
							const ssKey = `sahayog_cavg_p_${selDate}_${pageNum}`;
							const metaKey = `sahayog_cavg_meta_${selDate}`;
							try {
								const sData = sessionStorage.getItem(ssKey);
								const sMeta = sessionStorage.getItem(metaKey);
								if (sData && sMeta) {
									const metaObj = JSON.parse(sMeta);
									const parsedData = JSON.parse(sData);
									if (Array.isArray(parsedData) && parsedData.length > 0) {
										self.totalRows = metaObj.totalRows || parsedData.length;
										self.totalPages = metaObj.totalPages || Math.ceil(self.totalRows / self.pageSize) || 1;
										self.cachedPages[pageNum] = parsedData;
										self.cacheDate = selDate;
										resolve(true);
										return;
									}
								}
							} catch (e) {
								console.warn("sessionStorage read error", e);
							}

							const offset = (pageNum - 1) * self.pageSize;
							frappe.call({
								method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_cust_wise_avg_balance",
								args: {
									selected_date: selDate,
									limit: self.pageSize,
									offset: offset,
								},
								callback: function (r) {
									if (r.message && r.message.data) {
										self.totalRows = r.message.total_rows || 0;
										self.totalPages = Math.ceil(self.totalRows / self.pageSize) || 1;
										self.cachedPages[pageNum] = r.message.data;
										self.cacheDate = selDate;

										try {
											sessionStorage.setItem(ssKey, JSON.stringify(r.message.data));
											sessionStorage.setItem(metaKey, JSON.stringify({
												totalRows: self.totalRows,
												totalPages: self.totalPages
											}));
										} catch (e) {
											console.warn("sessionStorage write error", e);
										}
										resolve(true);
									} else {
										resolve(false);
									}
								},
								error: function () { resolve(false); },
							});
						});
					};

					const startBgFetch = (fromPage) => {
						if (self._bgRunning) return;
						self._bgRunning = true;
						const seq = self._renderSeq;
						const maxPreloadPages = Math.min(self.totalPages, 4);
						const maxPreloadRecords = maxPreloadPages * self.pageSize;

						const loadNext = (page) => {
							if (seq !== self._renderSeq) { self._bgRunning = false; return; }
							if (page > self.totalPages || Object.keys(self.cachedPages).length * self.pageSize >= maxPreloadRecords) {
								self._bgRunning = false;
								renderPaginationBar();
								return;
							}
							if (self.cachedPages[page]) {
								loadNext(page + 1);
								return;
							}
							fetchPageAjax(page).then(() => {
								if (seq !== self._renderSeq) { self._bgRunning = false; return; }
								updateCount();
								renderPaginationBar();
								setTimeout(() => loadNext(page + 1), 2000);
							});
						};
						loadNext(fromPage);
					};

					const preloadPage = (pageNum) => {
						if (self.cachedPages[pageNum] || self._bgRunning) return;
						self._bgRunning = true;
						fetchPageAjax(pageNum).then(() => {
							self._bgRunning = false;
							updateCount();
							renderPaginationBar();
						});
					};

					const goToPage = (pageNum) => {
						if (pageNum < 1 || pageNum > self.totalPages) return;
						if (self.cachedPages[pageNum]) {
							self.currentPage = pageNum;
							renderPage();
							return;
						}
						container.find("#cavg-loading").show();
						fetchPageAjax(pageNum).then(() => {
							container.find("#cavg-loading").hide();
							container.find("#cavg-table-container").show();
							self.currentPage = pageNum;
							renderPage();
							const nextBg = Math.max(...Object.keys(self.cachedPages).map(Number), 0) + 1;
							if (nextBg <= self.totalPages) startBgFetch(nextBg);
						});
					};

					container.off("input", "#cavg-search").on("input", "#cavg-search", function () {
						clearTimeout(self._searchTimeout);
						self._searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (Object.keys(self.cachedPages).length > 0) renderPage();
						}, 300);
					});

					container.off("click", "#cavg-refetch").on("click", "#cavg-refetch", function () {
						self.currentPage = 1;
						self.totalRows = 0;
						self.totalPages = 0;
						self.cachedPages = {};
						self.cacheDate = null;
						self.searchTerm = "";
						self._bgRunning = false;
						self._renderSeq++;

						try {
							const selDate = dashboardInstance.state.selectedDate;
							const prefix = `sahayog_cavg_p_${selDate}_`;
							const metaKey = `sahayog_cavg_meta_${selDate}`;
							sessionStorage.removeItem(metaKey);
							Object.keys(sessionStorage).forEach(k => {
								if (k && k.startsWith(prefix)) sessionStorage.removeItem(k);
							});
						} catch (e) {}

						container.find("#cavg-search").val("");
						container.find("#cavg-table-container").hide().empty();
						container.find("#cavg-pagination").hide().html("");
						container.find("#cavg-loading").show();
						fetchPageAjax(1).then(() => {
							container.find("#cavg-loading").hide();
							container.find("#cavg-table-container").show();
							self.currentPage = 1;
							renderPage();
							startBgFetch(2);
						});
					});

					container.off("click", ".cavg-page-btn[data-page]").on("click", ".cavg-page-btn[data-page]", function () {
						const page = parseInt($(this).data("page"));
						if (page && page !== self.currentPage) goToPage(page);
					});

					container.off("click", "#cavg-prev").on("click", "#cavg-prev", function () {
						if (self.currentPage > 1) goToPage(self.currentPage - 1);
					});

					container.off("click", "#cavg-next").on("click", "#cavg-next", function () {
						if (self.currentPage < self.totalPages) goToPage(self.currentPage + 1);
					});

					container.off("mouseenter", ".cavg-page-btn[data-page]").on("mouseenter", ".cavg-page-btn[data-page]", function () {
						const page = parseInt($(this).data("page"));
						if (page && !self.cachedPages[page]) preloadPage(page);
					});

					container.off("mouseenter", "#cavg-next").on("mouseenter", "#cavg-next", function () {
						const next = self.currentPage + 1;
						if (next <= self.totalPages && !self.cachedPages[next]) preloadPage(next);
					});

					const selDate = dashboardInstance.state.selectedDate || frappe.datetime.get_today();
					if (Object.keys(self.cachedPages).length > 0 && self.cacheDate === selDate) {
						container.find("#cavg-loading").hide();
						container.find("#cavg-table-container").show();
						renderPage();
					} else {
						fetchPageAjax(1).then(() => {
							container.find("#cavg-loading").hide();
							container.find("#cavg-table-container").show();
							self.currentPage = 1;
							renderPage();
							startBgFetch(2);
						});
					}

				},
			},
			{
				id: "gl_wise_ch_report",
				name: "GL Wise CH Report",
				tableData: [],
				allProducts: [],
				expandedZones: {},
				expandedRegions: {},
				expandedDistricts: {},
				searchTerm: "",
				selectedMisZones: [],
				checkedRows: {},
				render: function (container, dashboardInstance, seq) {
					const self = this;
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<input type="text" id="mis-search" placeholder="Search branch or SOL ID..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 200px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
								<span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
								<div class="btn-group mis-format-toggle" role="group">
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
								</div>
							</div>
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							${dashboardInstance.buildMisSkeletonTable("Fetching latest GL Wise CH Report data...")}
						</div>
						<div id="mis-zone-filter-row" style="display: none; margin-bottom: 10px;"></div>
						<div id="mis-table-container" ${self.tableData && self.tableData.length > 0 ? "" : 'style="display: none;"'}></div>
					`);

					if (self.tableData && self.tableData.length > 0) {
						self.renderGLWiseTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
						container.find("#mis-controls, #mis-table-container, #mis-zone-filter-row").show();
						container.find("#mis-loading").hide();
						self.attachReportEventHandlers(container, dashboardInstance);
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_gl_wise_ch_report_data",
						args: { selected_date: dashboardInstance.state.selectedDate },
						callback: function (r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							if (r.message) {
								self.tableData = r.message.product_wise || [];
								self.allProducts = r.message.all_products || [];
								self.renderGLWiseTable(container.find("#mis-table-container"), dashboardInstance);
								self.renderZoneFilterTags(container, dashboardInstance);
							}
							container.find("#mis-loading").hide();
							container.find("#mis-controls, #mis-table-container, #mis-zone-filter-row").show();
							self.attachReportEventHandlers(container, dashboardInstance);
						}
					});
					self.attachReportEventHandlers(container, dashboardInstance);
				},
				attachReportEventHandlers: function (container, dashboardInstance) {
					const self = this;
					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").each(function () {
							const btn = $(this);
							const isActive = btn.data("format") === format;
							btn.css("background", isActive ? "#417d81" : "#e2e8f0");
							btn.css("color", isActive ? "white" : "#475569");
						});
						if (self.tableData && self.tableData.length > 0) {
							self.renderGLWiseTable(container.find("#mis-table-container"), dashboardInstance);
						}
					});
					let searchTimeout;
					container.off("input", "#mis-search").on("input", "#mis-search", function () {
						clearTimeout(searchTimeout);
						searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (self.tableData) {
								self.renderGLWiseTable(container.find("#mis-table-container"), dashboardInstance);
							}
						}, 300);
					});
					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.tableData = [];
						self.allProducts = [];
						self.expandedZones = {};
						self.selectedMisZones = [];
						self.searchTerm = "";
						self.checkedRows = {};
						dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
						self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
					});
				},
				renderGLWiseTable: function (tableContainer, dashboardInstance) {
					const self = this;
					let productData = self.tableData;
					if (!productData || productData.length === 0) {
						tableContainer.html(`
							<div style="text-align: center; padding: 50px; color: #778da9; font-size: 16px;">
								<div style="font-size: 48px; margin-bottom: 15px;">📭</div>
								<div style="font-weight: 600; margin-bottom: 8px;">No data available</div>
							</div>
						`);
						return;
					}
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						productData = productData.filter(item =>
							(item.type === "zone" && self.selectedMisZones.includes(item.name)) ||
							(item.type !== "zone" && self.selectedMisZones.includes(item.parent_zone))
						);
					}
					if (self.searchTerm) {
						const terms = self.searchTerm.split(",").map(s => s.trim()).filter(Boolean);
						productData = productData.filter(item => {
							if (item.type !== "sol") return true;
							const name = (item.name || "").toLowerCase();
							return terms.some(t => name.includes(t));
						});
					}
					if (!productData || productData.length === 0) {
						tableContainer.html(`
							<div style="text-align: center; padding: 50px; color: #778da9; font-size: 16px;">
								<div style="font-size: 48px; margin-bottom: 15px;">📭</div>
								<div style="font-weight: 600; margin-bottom: 8px;">No data available</div>
							</div>
						`);
						return;
					}

				const allProducts = self.allProducts.filter(p => p !== "TDA" && p !== "SHARE" && p !== "JLL RD" && p !== "SKBG" && p !== "TASKSILVER" && p !== "TASKWEALTH" && p !== "SAVSIL" && p !== "CUGOLD" && p !== "CUWEALTH");
				if (self.allProducts.includes("SHARE")) {
					allProducts.push("SHARE");
				}
				if (self.allProducts.includes("JLL RD")) {
					const rdIdx = allProducts.indexOf("RD");
					if (rdIdx !== -1) {
						allProducts.splice(rdIdx + 1, 0, "JLL RD");
					} else {
						allProducts.push("JLL RD");
					}
				}
				if (self.allProducts.includes("SKBG")) {
					const smbgIdx = allProducts.indexOf("SMBG");
					if (smbgIdx !== -1) {
						allProducts.splice(smbgIdx + 1, 0, "SKBG");
					} else {
						allProducts.push("SKBG");
					}
				}
				if (self.allProducts.includes("TASKSILVER") || self.allProducts.includes("TASKWEALTH") || self.allProducts.includes("SAVSIL") || self.allProducts.includes("CUGOLD") || self.allProducts.includes("CUWEALTH")) {
					const skbgIdx = allProducts.indexOf("SKBG");
					const newCols = ["TASKSILVER", "TASKWEALTH", "SAVSIL", "CUGOLD", "CUWEALTH"].filter(c => self.allProducts.includes(c));
					if (skbgIdx !== -1) {
						allProducts.splice(skbgIdx + 1, 0, ...newCols);
					} else {
						newCols.forEach(c => allProducts.push(c));
					}
				}

					// Build dynamic header with product columns
					let headerHtml = `
						<style>
							.gl-wise-table tbody tr:not(.grand-total-row):hover { background-color: #e8f4f8 !important; cursor: pointer; }
							.gl-wise-table tbody tr.checked-row { background-color: #c8e6c9 !important; }
							.gl-wise-table tbody tr.checked-row:hover { background-color: #a5d6a7 !important; }
							.gl-wise-table .row-checkbox { width: 32px; text-align: center; vertical-align: middle; }
							.gl-wise-table .row-checkbox input { cursor: pointer; width: 15px; height: 15px; accent-color: #417d81; }
							.gl-wise-scroll { overflow-x: auto; max-height: 550px; overflow-y: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
						</style>
						<div class="gl-wise-scroll">
						<table class="table table-bordered gl-wise-table">
							<thead>
								<tr class="zone-table-header">
									<th rowspan="2" style="width:32px;" class="row-checkbox"></th>
									<th rowspan="2" style="width:60px;">SR</th>
									<th rowspan="2" style="text-align: left;">Z/R/DIS/SOL</th>
					`;

					allProducts.forEach((product) => {
						headerHtml += `<th>${product}</th>`;
					});

					headerHtml += `
									<th rowspan="2" style="width:140px;">ACHIEVEMENT</th>
								</tr>
							</thead>
							<tbody>
					`;

					let html = headerHtml;

					let sr = 1;
					let zoneTotalAmount = 0;
					let productTotals = {};

					// Initialize product totals
					allProducts.forEach((product) => {
						productTotals[product] = 0;
					});

					productData.forEach((item) => {
						const products = item.products || {};

						if (item.type === "zone") {
							const isExpanded = self.expandedZones[item.path] || false;

							const checked = self.checkedRows[item.path] ? ' checked' : '';
							html += `
								<tr class="zone-total-row gl-total-row${checked ? ' checked-row' : ''}" data-path="${item.path}" style="background-color: #e0e1dd; font-weight: bold; cursor: pointer;">
									<td class="row-checkbox"><input type="checkbox" class="gl-row-checkbox" data-path="${item.path}"${checked}></td>
									<td>${sr++}</td>
									<td style="padding-left: 8px; text-align: left;">
										<span class="gl-toggle" style="margin-right: 6px; display: inline-block; width: 12px; font-size: 10px;">${isExpanded ? "▼" : "▶"}</span>
										<strong>${item.name}</strong>
									</td>
							`;

							// Add a column for each product (zone totals) and accumulate totals
							allProducts.forEach((product) => {
								const amount = products[product] || 0;
								productTotals[product] += amount;
								html += `<td>${dashboardInstance.formatCurrency(amount)}</td>`;
							});

							html += `
									<td>${dashboardInstance.formatCurrency(item.amount)}</td>
								</tr>
							`;

							zoneTotalAmount += item.amount;
						} else if (item.type === "region") {
							const isZoneExpanded = self.expandedZones[item.parent_zone] || false;
							const isExpanded = self.expandedZones[item.path] || false;

							const checked = self.checkedRows[item.path] ? ' checked' : '';
							html += `
								<tr class="region-total-row gl-total-row${checked ? ' checked-row' : ''}" data-path="${item.path}" style="display: ${isZoneExpanded ? "table-row" : "none"}; background-color: #f8fafc; font-weight: bold; cursor: pointer; border-left: 4px solid #417d81;">
									<td class="row-checkbox"><input type="checkbox" class="gl-row-checkbox" data-path="${item.path}"${checked}></td>
									<td></td>
									<td style="padding-left: 8px; color: #097c80; text-align: left;">
										<span class="gl-toggle" style="margin-right: 6px; display: inline-block; width: 12px; font-size: 10px;">${isExpanded ? "▼" : "▶"}</span>
										<strong>${item.name}</strong>
									</td>
							`;

							// Add a column for each product
							allProducts.forEach((product) => {
								const amount = products[product] || 0;
								html += `<td>${dashboardInstance.formatCurrency(amount)}</td>`;
							});

							html += `
									<td>${dashboardInstance.formatCurrency(item.amount)}</td>
								</tr>
							`;
						} else if (item.type === "district") {
							const isZoneExpanded = self.expandedZones[item.parent_zone] || false;
							const isRegionExpanded = self.expandedZones[item.parent_region] || false;
							const isExpanded = self.expandedZones[item.path] || false;
							const isVisible = isZoneExpanded && isRegionExpanded;

							const checked = self.checkedRows[item.path] ? ' checked' : '';
							html += `
								<tr class="district-total-row gl-total-row${checked ? ' checked-row' : ''}" data-path="${item.path}" style="display: ${isVisible ? "table-row" : "none"}; background-color: #fafafa; font-weight: bold; cursor: pointer; border-left: 6px solid #64748b;">
									<td class="row-checkbox"><input type="checkbox" class="gl-row-checkbox" data-path="${item.path}"${checked}></td>
									<td></td>
									<td style="padding-left: 8px; color: #1e293b; text-align: left;">
										<span class="gl-toggle" style="margin-right: 6px; display: inline-block; width: 12px; font-size: 10px;">${isExpanded ? "▼" : "▶"}</span>
										<strong>${item.name}</strong>
									</td>
							`;

							// Add a column for each product
							allProducts.forEach((product) => {
								const amount = products[product] || 0;
								html += `<td>${dashboardInstance.formatCurrency(amount)}</td>`;
							});

							html += `
									<td>${dashboardInstance.formatCurrency(item.amount)}</td>
								</tr>
							`;
						} else if (item.type === "sol") {
							const isZoneExpanded = self.expandedZones[item.parent_zone] || false;
							const isRegionExpanded = self.expandedZones[item.parent_region] || false;
							const isDistrictExpanded = self.expandedZones[item.parent_district] || false;
							const isVisible = isZoneExpanded && isRegionExpanded && isDistrictExpanded;

							const checked = self.checkedRows[item.path] ? ' checked' : '';
							html += `
								<tr class="sol-detail-row${checked ? ' checked-row' : ''}" style="display: ${isVisible ? "table-row" : "none"}; background: #ffffff; border-left: 8px solid #cbd5e1;">
									<td class="row-checkbox"><input type="checkbox" class="gl-row-checkbox" data-path="${item.path}"${checked}></td>
									<td></td>
									<td style="padding-left: 8px; color: #475569; font-weight: normal; text-align: left;">
										${item.name}
									</td>
							`;

							// Add a column for each product
							allProducts.forEach((product) => {
								const amount = products[product] || 0;
								html += `<td>${dashboardInstance.formatCurrency(amount)}</td>`;
							});

							html += `
									<td>${dashboardInstance.formatCurrency(item.amount)}</td>
								</tr>
							`;
						}
					});

					// Grand Total Row
					html += `
						</tbody>
						<tfoot style="background-color: #264a4d; color: #ffffff; font-weight: bold; border-top: 2px solid #3d7579;">
							<tr style="height: 40px;">
								<td></td>
								<td colspan="2" style="text-align: left; padding-left: 12px; text-transform: uppercase; letter-spacing: 1px;">TOTAL</td>
					`;

					// Add product-wise totals for each product column
					allProducts.forEach((product) => {
						html += `<td>${dashboardInstance.formatCurrency(productTotals[product])}</td>`;
					});

					html += `
								<td>${dashboardInstance.formatCurrency(zoneTotalAmount)}</td>
							</tr>
						</tfoot>
					</table>
					</div>`;

					tableContainer.html(html);

					// Attach Checkbox Handlers
					tableContainer.find(".gl-row-checkbox").off("change").on("change", function (e) {
						e.stopPropagation();
						const path = $(this).data("path");
						const checked = $(this).prop("checked");
						if (checked) {
							self.checkedRows[path] = true;
							$(this).closest("tr").addClass("checked-row");
						} else {
							delete self.checkedRows[path];
							$(this).closest("tr").removeClass("checked-row");
						}
					});
					// Attach Expand/Collapse Handlers (skip if checkbox clicked)
					tableContainer.find(".gl-total-row").off("click").on("click", function (e) {
						if ($(e.target).is("input[type=checkbox]")) return;
						const path = $(this).data("path");
						self.expandedZones[path] = !self.expandedZones[path];
						self.renderGLWiseTable(tableContainer, dashboardInstance);
					});
				},
				renderZoneFilterTags: function (container, dashboardInstance) {
					const self = this;
					if (!self.tableData || self.tableData.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					let zones = [...new Set(self.tableData.filter(r => r.type === "zone").map(r => r.name).filter(Boolean))].sort();
					if (zones.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					const allSelected = self.selectedMisZones.length === 0;
					let html = '<span style="font-weight: 600; color: #475569; font-size: 13px; white-space: nowrap;">Zone:</span>';
					html += `<button class="mis-zone-filter-tag ${allSelected ? "active" : ""}" data-zone="all" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${allSelected ? "#417d81" : "#fff"}; color: ${allSelected ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">All</button>`;
					zones.forEach(zone => {
						const active = self.selectedMisZones.includes(zone);
						html += `<button class="mis-zone-filter-tag ${active ? "active" : ""}" data-zone="${zone}" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${active ? "#417d81" : "#fff"}; color: ${active ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">${zone}</button>`;
					});
					const $row = container.find("#mis-zone-filter-row");
					$row.html(html).css("display", "flex").css({ "align-items": "center", "gap": "8px", "flex-wrap": "wrap", "margin-bottom": "10px" });
					container.off("click", ".mis-zone-filter-tag").on("click", ".mis-zone-filter-tag", function () {
						const zone = $(this).data("zone");
						if (zone === "all") {
							self.selectedMisZones = [];
						} else {
							const idx = self.selectedMisZones.indexOf(zone);
							if (idx > -1) { self.selectedMisZones.splice(idx, 1); } else { self.selectedMisZones.push(zone); }
						}
						self.renderZoneFilterTags(container, dashboardInstance);
						self.renderGLWiseTable(container.find("#mis-table-container"), dashboardInstance);
					});
				}
			},
			// ── DD Tracker Report (Dropdown Group) ──
			{
				id: "dd_tracker_report_group",
				name: "DD Tracker Report",
				type: "group",
				children: ["bucket_wise_account_mis", "new_account_report", "staff_wise_demand_collection", "agent_wise_demand_collection"]
			},
			{	id: "bucket_wise_account_mis",
				name: "Bucket Wise Account MIS",
				tableData: [],
				expandedZones: {},
				expandedRegions: {},
				expandedDistricts: {},
				checkedRows: {},
				searchTerm: "",
				allExpanded: false,
				selectedMisZones: [],
				render: function(container, dashboardInstance, seq) {
					const self = this;
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<input type="text" id="mis-search" placeholder="Search branch, SOL ID or district..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 200px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="mis-expand-toggle" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">▼ Expand All</button>
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
								<span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
								<div class="btn-group mis-format-toggle" role="group">
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
								</div>
							</div>
							<div style="font-size: 13px; font-weight: 700; color: #417d81; background: rgba(65,125,129,0.08); padding: 6px 12px; border-radius: 6px;" id="mis-records-count"></div>
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							${dashboardInstance.buildMisSkeletonTable("Loading Bucket Wise Account MIS...")}
						</div>
						<div id="mis-zone-filter-row" style="display: none; margin-bottom: 10px;"></div>
						<div id="mis-kpi-container" ${self.tableData && self.tableData.length ? "" : 'style="display: none;"'}></div>
						<div id="mis-table-container" ${self.tableData ? "" : 'style="display: none;"'}></div>
					`);

					if (self.tableData && self.tableData.length > 0) {
						self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
						container.find("#mis-records-count").text(`${self.tableData.length} records`);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
						container.find("#mis-controls, #mis-table-container, #mis-kpi-container").show();
						container.find("#mis-loading").hide();
						self.attachReportEventHandlers(container, dashboardInstance);
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_bucket_wise_account_mis_data",
						args: { selected_date: dashboardInstance.state.selectedDate },
						callback: function(r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							if (r.message && r.message.summary) {
								self.tableData = r.message.summary;
								self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
								container.find("#mis-records-count").text(`${r.message.summary.length} records`);
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
								self.renderZoneFilterTags(container, dashboardInstance);
							}
							container.find("#mis-loading").hide();
							container.find("#mis-controls, #mis-table-container, #mis-kpi-container, #mis-zone-filter-row").show();
						}
					});
					self.attachReportEventHandlers(container, dashboardInstance);
				},
				attachReportEventHandlers: function(container, dashboardInstance) {
					const self = this;
					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").each(function () {
							const btn = $(this);
							const isActive = btn.data("format") === format;
							btn.css("background", isActive ? "#417d81" : "#e2e8f0");
							btn.css("color", isActive ? "white" : "#475569");
						});
						if (self.tableData && self.tableData.length > 0) {
							self.switchFormat(format, container, dashboardInstance);
						}
					});
					let searchTimeout;
					container.off("input", "#mis-search").on("input", "#mis-search", function () {
						clearTimeout(searchTimeout);
						searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (self.tableData) {
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
							}
						}, 300);
					});
					container.off("click", "#mis-expand-toggle").on("click", "#mis-expand-toggle", function () {
						self.allExpanded = !self.allExpanded;
						const expand = self.allExpanded;
						if (!self.tableData) return;
						const zoneData = self.aggregateByZone();
						zoneData.forEach(z => {
							self.expandedZones[z.zone] = expand;
							z.regions.forEach(r => {
								self.expandedRegions[z.zone + "::" + r.region] = expand;
								r.districts.forEach(d => {
									self.expandedDistricts[z.zone + "::" + r.region + "::" + d.district] = expand;
								});
							});
						});
						$(this).text(expand ? "▲ Collapse All" : "▼ Expand All");
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.refetchData(container, dashboardInstance);
					});
				},
				renderKPI: function(container, dashboardInstance) {
					const self = this;
					const data = self.tableData || [];
					const totalAccounts = data.reduce((s, r) => s + (r.grand_total || 0), 0);
					const excessCount = data.reduce((s, r) => s + (r.Excess || 0), 0);
					const aCount = data.reduce((s, r) => s + (r.A || 0), 0);
					const bCount = data.reduce((s, r) => s + (r.B || 0), 0);
					const cCount = data.reduce((s, r) => s + (r.C || 0), 0);
					const dCount = data.reduce((s, r) => s + (r.D || 0), 0);
					const defaultCount = data.reduce((s, r) => s + (r.DEFAULT || 0), 0);

					const fmtCount = (val) => {
						if (!val && val !== 0) return "0";
						const format = dashboardInstance.state.formatMode || "number";
						if (format === "words") {
							if (val >= 10000000) return (val / 10000000).toFixed(2) + " Cr";
							if (val >= 100000) return (val / 100000).toFixed(2) + " L";
							if (val >= 1000) return (val / 1000).toFixed(2) + " K";
						}
						return new Intl.NumberFormat("en-IN").format(val);
					};

					const kpiCards = [
						{ label: "Total Accounts", value: fmtCount(totalAccounts), color: "#3b82f6", bg: "#eff6ff", icon: "📊" },
						{ label: "Cat A (75%+)", value: fmtCount(aCount), color: "#06b6d4", bg: "#ecfeff", icon: "🟢" },
						{ label: "Cat B (50%+)", value: fmtCount(bCount), color: "#f59e0b", bg: "#fffbeb", icon: "🟡" },
						{ label: "Cat C (25%+)", value: fmtCount(cCount), color: "#f97316", bg: "#fff7ed", icon: "🟠" },
						{ label: "Cat D (<25%)", value: fmtCount(dCount), color: "#ef4444", bg: "#fef2f2", icon: "🔴" },
						{ label: "Default", value: fmtCount(defaultCount), color: "#64748b", bg: "#f8fafc", icon: "⏳" },
						{ label: "Excess (>100%)", value: fmtCount(excessCount), color: "#10b981", bg: "#ecfdf5", icon: "📈" }
					];
					container.html(`
						<style>
							#mis-kpi-container { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
							#mis-kpi-container .kpi-card { flex: 1 1 180px; min-width: 150px; border-radius: 10px; padding: 16px 18px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); box-sizing: border-box; min-height: 100px; }
							#mis-kpi-container .kpi-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
							#mis-kpi-container .kpi-icon { font-size: 20px; flex-shrink: 0; line-height: 1; }
							#mis-kpi-container .kpi-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Inter', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
							#mis-kpi-container .kpi-value { font-size: clamp(18px, 2.2vw, 24px); font-weight: 800; font-family: 'Inter', sans-serif; line-height: 1.2; word-break: break-word; }
							@media (max-width: 768px) { #mis-kpi-container .kpi-card { flex: 1 1 140px; min-width: 120px; padding: 12px 14px; min-height: 80px; } #mis-kpi-container .kpi-value { font-size: 16px; } }
							@media (max-width: 480px) { #mis-kpi-container .kpi-card { flex: 1 1 100%; min-width: unset; } }
						</style>
						${kpiCards.map(card => `<div class="kpi-card" style="background: ${card.bg}; border-left: 4px solid ${card.color};"><div class="kpi-card-header"><span class="kpi-icon">${card.icon}</span><span class="kpi-label">${card.label}</span></div><div class="kpi-value" style="color: ${card.color};">${card.value}</div></div>`).join('')}
					`);
				},
				refetchData: function(container, dashboardInstance) {
					const self = this;
					self.tableData = [];
					self.expandedZones = {};
					self.expandedRegions = {};
					self.expandedDistricts = {};
					self.checkedRows = {};
					self.searchTerm = "";
					self.allExpanded = false;
					self.selectedMisZones = [];
					dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
					self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
				},
				switchFormat: function(format, container, dashboardInstance) {
					const self = this;
					if (self.tableData && self.tableData.length > 0) {
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					}
					self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
				},
				renderMisTable: function(tableContainer, dashboardInstance) {
					const self = this;
					self.renderAnalysisTable(tableContainer, dashboardInstance);
				},
				renderZoneFilterTags: function(container, dashboardInstance) {
					const self = this;
					if (!self.tableData || self.tableData.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					let zones = [...new Set(self.tableData.map(r => r.zone).filter(Boolean))].sort();
					if (zones.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					const allSelected = self.selectedMisZones.length === 0;
					let html = '<span style="font-weight: 600; color: #475569; font-size: 13px; white-space: nowrap;">Zone:</span>';
					html += `<button class="mis-zone-filter-tag ${allSelected ? "active" : ""}" data-zone="all" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${allSelected ? "#417d81" : "#fff"}; color: ${allSelected ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">All</button>`;
					zones.forEach(zone => {
						const active = self.selectedMisZones.includes(zone);
						html += `<button class="mis-zone-filter-tag ${active ? "active" : ""}" data-zone="${zone}" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${active ? "#417d81" : "#fff"}; color: ${active ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">${zone}</button>`;
					});
					const $row = container.find("#mis-zone-filter-row");
					$row.html(html).css("display", "flex").css({ "align-items": "center", "gap": "8px", "flex-wrap": "wrap", "margin-bottom": "10px" });
					container.off("click", ".mis-zone-filter-tag").on("click", ".mis-zone-filter-tag", function () {
						const zone = $(this).data("zone");
						if (zone === "all") {
							self.selectedMisZones = [];
						} else {
							const idx = self.selectedMisZones.indexOf(zone);
							if (idx > -1) { self.selectedMisZones.splice(idx, 1); } else { self.selectedMisZones.push(zone); }
						}
						self.renderZoneFilterTags(container, dashboardInstance);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
				},
				aggregateByZone: function() {
					const self = this;
					let data = self.tableData || [];
					const term = (self.searchTerm || "").trim();
					if (term) {
						const terms = term.split(",").map(t => t.trim().toLowerCase()).filter(t => t);
						data = data.filter(row => {
							const br = (row.sol_desc || row.sol_id || "").toLowerCase();
							const id = (row.sol_id || "").toLowerCase();
							const dt = (row.district || "").toLowerCase();
							return terms.some(t => br.includes(t) || id.includes(t) || dt.includes(t));
						});
					}
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						data = data.filter(row => self.selectedMisZones.includes(row.zone));
					}
					const zoneMap = {};
					data.forEach(row => {
						const zone = row.zone || "Unknown";
						const region = row.region || "Unknown";
						const district = row.district || "Unknown";

						if (!zoneMap[zone]) {
							zoneMap[zone] = { 
								zone, 
								regions: {}, 
								branches: [], 
								A: 0, B: 0, C: 0, D: 0, DEFAULT: 0, Excess: 0, grand_total: 0 
							};
						}
						if (!zoneMap[zone].regions[region]) {
							zoneMap[zone].regions[region] = { 
								region, 
								districts: {}, 
								branches: [], 
								A: 0, B: 0, C: 0, D: 0, DEFAULT: 0, Excess: 0, grand_total: 0 
							};
						}
						if (!zoneMap[zone].regions[region].districts[district]) {
							zoneMap[zone].regions[region].districts[district] = {
								district,
								branches: [],
								A: 0, B: 0, C: 0, D: 0, DEFAULT: 0, Excess: 0, grand_total: 0 
							};
						}

						zoneMap[zone].branches.push(row);
						zoneMap[zone].regions[region].branches.push(row);
						zoneMap[zone].regions[region].districts[district].branches.push(row);
						
						// Aggregate metrics
						["A", "B", "C", "D", "DEFAULT", "Excess", "grand_total"].forEach(k => {
							zoneMap[zone][k] += (row[k] || 0);
							zoneMap[zone].regions[region][k] += (row[k] || 0);
							zoneMap[zone].regions[region].districts[district][k] += (row[k] || 0);
						});
					});
					const sortedZones = Object.keys(zoneMap).sort();
					const result = [];
					sortedZones.forEach(zoneName => {
						const zd = zoneMap[zoneName];
						const sortedRegions = Object.keys(zd.regions).sort();
						const regions = sortedRegions.map(rn => {
							const rd = zd.regions[rn];
							const sortedDistricts = Object.keys(rd.districts).sort();
							const districts = sortedDistricts.map(dn => rd.districts[dn]);
							return { region: rn, data: rd, districts: districts };
						});
						result.push({ zone: zoneName, data: zd, regions: regions });
					});
					return result;
				},
				renderAnalysisTable: function(tableContainer, dashboardInstance) {
					const self = this;
					const format = dashboardInstance.state.formatMode || "number";
					const fmtCount = (val) => {
						if (!val && val !== 0) return "0";
						if (format === "words") {
							if (val >= 10000000) return (val / 10000000).toFixed(2) + " Cr";
							if (val >= 100000) return (val / 100000).toFixed(2) + " L";
							if (val >= 1000) return (val / 1000).toFixed(2) + " K";
						}
						return new Intl.NumberFormat("en-IN").format(val);
					};

					const zoneData = self.aggregateByZone();
					const totalFilteredBranches = zoneData.reduce((s, z) => s + z.data.branches.length, 0);
					const totalAllBranches = (self.tableData || []).length;
					const $badge = tableContainer.parent().find("#mis-records-count");
					$badge.text(totalFilteredBranches + " / " + totalAllBranches + " branches" + (self.searchTerm ? " (filtered)" : ""));
					if (totalFilteredBranches === totalAllBranches && !self.searchTerm) $badge.hide(); else $badge.show();

					if (!zoneData || zoneData.length === 0) {
						tableContainer.html('<div style="padding: 30px; text-align: center; color: #64748b; font-weight: 600; font-family: \'Inter\', sans-serif;">No data to display.</div>');
						return;
					}

					const grandTotal = { A: 0, B: 0, C: 0, D: 0, DEFAULT: 0, Excess: 0, grand_total: 0 };
					zoneData.forEach(z => {
						["A", "B", "C", "D", "DEFAULT", "Excess", "grand_total"].forEach(k => {
							grandTotal[k] += z.data[k];
						});
					});

					const buckets = ["A", "B", "C", "D", "DEFAULT", "Excess"];

					let sr = 0;
					let rowsHtml = "";
					zoneData.forEach(z => {
						sr++;
						const zoneExpanded = self.expandedZones[z.zone];
						const zoneRow = z.data;
						const zoneChecked = self.checkedRows["zone::" + z.zone];
						
						rowsHtml += `<tr class="mis-zone-row${zoneChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-check-id="zone::${z.zone}" style="cursor: pointer; background: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; width: 30px; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="zone::${z.zone}" ${zoneChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; width: 40px; font-size: 14px;">${sr}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; white-space: nowrap; font-size: 14px;"><span class="mis-zone-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #64748b;">${zoneExpanded ? "▼" : "▶"}</span>${z.zone}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px;">${zoneRow.branches.length}</td>
							${buckets.map(b => `<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; font-size: 14px;">${fmtCount(zoneRow[b])}</td>`).join('')}
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; font-size: 14px; background: #e2e8f0;">${fmtCount(zoneRow.grand_total)}</td>
						</tr>`;

						z.regions.forEach(regionObj => {
							const region = regionObj.region;
							const regionRow = regionObj.data;
							const regionKey = z.zone + "::" + region;
							const regionExpanded = self.expandedRegions[regionKey];
							const regionChecked = self.checkedRows[regionKey];
							
							rowsHtml += `<tr class="mis-region-row${regionChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-check-id="${regionKey}" style="display: ${zoneExpanded ? "table-row" : "none"}; cursor: pointer; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
								<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${regionKey}" ${regionChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
								<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
								<td style="padding: 8px 14px; color: #334155; white-space: nowrap; font-size: 14px; padding-left: 24px; font-weight: 600;"><span class="mis-region-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #94a3b8;">${regionExpanded ? "▼" : "▶"}</span>${region}</td>
								<td style="padding: 8px 14px; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${regionRow.branches.length}</td>
								${buckets.map(b => `<td style="padding: 8px 14px; color: #334155; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtCount(regionRow[b])}</td>`).join('')}
								<td style="padding: 8px 14px; color: #334155; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f1f5f9;">${fmtCount(regionRow.grand_total)}</td>
							</tr>`;

							regionObj.districts.forEach(districtObj => {
								const district = districtObj.district;
								const districtKey = z.zone + "::" + region + "::" + district;
								const districtExpanded = self.expandedDistricts[districtKey];
								const districtChecked = self.checkedRows[districtKey];
								const showDistrict = zoneExpanded && regionExpanded;

								rowsHtml += `<tr class="mis-district-row${districtChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-check-id="${districtKey}" style="display: ${showDistrict ? "table-row" : "none"}; cursor: pointer; background: #fafaf9; border-bottom: 1px solid #e7e5e4;">
									<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${districtKey}" ${districtChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
									<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
									<td style="padding: 8px 14px; color: #44403c; white-space: nowrap; font-size: 14px; padding-left: 42px; font-weight: 600;"><span class="mis-district-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #a8a29e;">${districtExpanded ? "▼" : "▶"}</span>${district}</td>
									<td style="padding: 8px 14px; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${districtObj.branches.length}</td>
									${buckets.map(b => `<td style="padding: 8px 14px; color: #44403c; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtCount(districtObj[b])}</td>`).join('')}
									<td style="padding: 8px 14px; color: #44403c; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f5f5f4;">${fmtCount(districtObj.grand_total)}</td>
								</tr>`;

								districtObj.branches.forEach((branch, bi) => {
									const showBranch = zoneExpanded && regionExpanded && districtExpanded;
									const branchBg = bi % 2 === 0 ? "#ffffff" : "#f1f5f9";
									const solId = branch.sol_id || "branch_" + bi;
									const branchChecked = self.checkedRows[solId];
									
									rowsHtml += `<tr class="mis-branch-row${branchChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-check-id="${solId}" style="display: ${showBranch ? "table-row" : "none"}; background: ${branchBg}; border-bottom: 1px solid #e2e8f0;">
										<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${solId}" ${branchChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
										<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
										<td style="padding: 6px 14px; color: #475569; white-space: nowrap; font-size: 14px; padding-left: 60px; font-weight: 500;">${branch.sol_id} - ${branch.sol_desc || branch.branch_name}</td>
										<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">1</td>
										${buckets.map(b => `<td style="padding: 6px 14px; color: #475569; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtCount(branch[b])}</td>`).join('')}
										<td style="padding: 6px 14px; color: #475569; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f8fafc;">${fmtCount(branch.grand_total)}</td>
									</tr>`;
								});
							});
						});
					});

					const tableHtml = `
						<style>
							#mis-analysis-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
							#mis-analysis-table thead { position: sticky; top: 0; z-index: 2; }
							#mis-analysis-table tfoot { position: sticky; bottom: 0; z-index: 2; }
							#mis-analysis-table tfoot tr { box-shadow: 0 -2px 6px rgba(0,0,0,0.1); }
							#mis-analysis-table tbody tr { transition: background-color 0.2s ease; border-bottom: 1px solid #e2e8f0; }
							#mis-analysis-table tbody tr:hover { background: #dcfce7 !important; }
							#mis-analysis-table tbody tr.mis-row-checked { background: #bbf7d0 !important; }
							#mis-analysis-table tbody tr.mis-zone-row.mis-row-checked,
							#mis-analysis-table tbody tr.mis-region-row.mis-row-checked,
							#mis-analysis-table tbody tr.mis-district-row.mis-row-checked,
							#mis-analysis-table tbody tr.mis-branch-row.mis-row-checked { background: #86efac !important; }
							#mis-scroll-area { max-height: 550px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
						</style>
						<div id="mis-scroll-area">
							<table id="mis-analysis-table">
								<thead><tr style="background: linear-gradient(180deg, #3d7579 0%, #346569 100%); color: #ffffff;">
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 30px;"><input type="checkbox" class="mis-check-all" style="cursor: pointer; width: 14px; height: 14px;"></th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 40px;">Sr</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap;">Z / R / D / SOL Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap;">Branches</th>
									${buckets.map(b => `<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap;">${b}</th>`).join('')}
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap;">Grand Total</th>
								</tr></thead>
								<tbody>${rowsHtml}</tbody>
								<tfoot><tr style="background: #1e293b; color: #ffffff; font-weight: 700;">
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: left; white-space: nowrap; font-size: 14px;">TOTAL</td>
									<td style="padding: 10px 12px; text-align: center; white-space: nowrap; font-size: 14px;">${zoneData.reduce((s, z) => s + z.data.branches.length, 0)}</td>
									${buckets.map(b => `<td style="padding: 10px 12px; text-align: center; white-space: nowrap; font-size: 14px;">${fmtCount(grandTotal[b])}</td>`).join('')}
									<td style="padding: 10px 12px; text-align: center; white-space: nowrap; font-size: 14px;">${fmtCount(grandTotal.grand_total)}</td>
								</tr></tfoot>
							</table>
						</div>`;
					tableContainer.html(tableHtml);

					tableContainer.off("click", ".mis-zone-row").on("click", ".mis-zone-row", function (e) {
						if ($(e.target).closest(".mis-region-toggle, .mis-region-row, input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						self.expandedZones[zone] = !self.expandedZones[zone];
						const show = self.expandedZones[zone];
						const $regionRows = tableContainer.find(`.mis-region-row[data-zone="${zone}"]`);
						const $districtRows = tableContainer.find(`.mis-district-row[data-zone="${zone}"]`);
						const $branchRows = tableContainer.find(`.mis-branch-row[data-zone="${zone}"]`);
						if (show) {
							$regionRows.stop(true, true).slideDown(200);
							$regionRows.each(function () {
								const r = $(this).data("region");
								const rKey = zone + "::" + r;
								if (self.expandedRegions[rKey]) {
									tableContainer.find(`.mis-district-row[data-zone="${zone}"][data-region="${r}"]`).stop(true, true).slideDown(200);
									$districtRows.each(function () {
										const d = $(this).data("district");
										const dKey = zone + "::" + r + "::" + d;
										if (self.expandedDistricts[dKey]) {
											tableContainer.find(`.mis-branch-row[data-zone="${zone}"][data-region="${r}"][data-district="${d}"]`).stop(true, true).slideDown(200);
										}
									});
								}
							});
						} else {
							$branchRows.stop(true, true).slideUp(150);
							$districtRows.stop(true, true).slideUp(150);
							$regionRows.stop(true, true).slideUp(200);
						}
						$(this).find(".mis-zone-toggle").text(show ? "▼" : "▶");
					});

					tableContainer.off("click", ".mis-region-row").on("click", ".mis-region-row", function (e) {
						if ($(e.target).closest(".mis-district-toggle, .mis-district-row, input[type=checkbox]").length) return;
						e.stopPropagation();
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const regionKey = zone + "::" + region;
						self.expandedRegions[regionKey] = !self.expandedRegions[regionKey];
						const show = self.expandedRegions[regionKey];
						const $districtRows = tableContainer.find(`.mis-district-row[data-zone="${zone}"][data-region="${region}"]`);
						const $branchRows = tableContainer.find(`.mis-branch-row[data-zone="${zone}"][data-region="${region}"]`);
						if (show) {
							$districtRows.stop(true, true).slideDown(200);
							$districtRows.each(function () {
								const d = $(this).data("district");
								const dKey = zone + "::" + region + "::" + d;
								if (self.expandedDistricts[dKey]) {
									tableContainer.find(`.mis-branch-row[data-zone="${zone}"][data-region="${region}"][data-district="${d}"]`).stop(true, true).slideDown(200);
								}
							});
						} else {
							$branchRows.stop(true, true).slideUp(150);
							$districtRows.stop(true, true).slideUp(200);
						}
						$(this).find(".mis-region-toggle").text(show ? "▼" : "▶");
					});

					tableContainer.off("click", ".mis-district-row").on("click", ".mis-district-row", function (e) {
						if ($(e.target).is("input[type=checkbox]")) return;
						e.stopPropagation();
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const districtKey = zone + "::" + region + "::" + district;
						self.expandedDistricts[districtKey] = !self.expandedDistricts[districtKey];
						const show = self.expandedDistricts[districtKey];
						const $branchRows = tableContainer.find(`.mis-branch-row[data-zone="${zone}"][data-region="${region}"][data-district="${district}"]`);
						if (show) { 
							$branchRows.stop(true, true).slideDown(200); 
						} else { 
							$branchRows.stop(true, true).slideUp(150); 
						}
						$(this).find(".mis-district-toggle").text(show ? "▼" : "▶");
					});

					tableContainer.off("change", ".mis-row-check").on("change", ".mis-row-check", function () {
						const checkId = $(this).data("check-id");
						const checked = $(this).prop("checked");
						self.checkedRows[checkId] = checked;
						$(this).closest("tr").toggleClass("mis-row-checked", checked);
					});

					tableContainer.off("change", ".mis-check-all").on("change", ".mis-check-all", function () {
						const checked = $(this).prop("checked");
						tableContainer.find(".mis-row-check").each(function () {
							$(this).prop("checked", checked).trigger("change");
						});
					});
				},
			},
			{	id: "new_account_report",
				name: "New Account Report",
				tableData: [],
				expandedZones: {},
				expandedRegions: {},
				expandedDistricts: {},
				expandedBranches: {},
				checkedRows: {},
				searchTerm: "",
				allExpanded: false,
				selectedMisZones: [],
				render: function(container, dashboardInstance, seq) {
					const self = this;
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<input type="text" id="mis-search" placeholder="Search branch, SOL ID, district or authorizer..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 200px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="mis-expand-toggle" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">▼ Expand All</button>
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
								<span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
								<div class="btn-group mis-format-toggle" role="group">
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
								</div>
							</div>
							<div style="font-size: 13px; font-weight: 700; color: #417d81; background: rgba(65,125,129,0.08); padding: 6px 12px; border-radius: 6px;" id="mis-records-count"></div>
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							${dashboardInstance.buildMisSkeletonTable("Loading New Account Report...")}
						</div>
						<div id="mis-zone-filter-row" style="display: none; margin-bottom: 10px;"></div>
						<div id="mis-kpi-container" ${self.tableData && self.tableData.length ? "" : 'style="display: none;"'}></div>
						<div id="mis-table-container" ${self.tableData ? "" : 'style="display: none;"'}></div>
					`);

					if (self.tableData && self.tableData.length > 0) {
						self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
						container.find("#mis-records-count").text(`${self.tableData.length} records`);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
						container.find("#mis-controls, #mis-table-container, #mis-kpi-container").show();
						container.find("#mis-loading").hide();
						self.attachReportEventHandlers(container, dashboardInstance);
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_new_account_report_data",
						args: { selected_date: dashboardInstance.state.selectedDate },
						callback: function(r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							container.find("#mis-loading").hide();
							if (r.message && r.message.length) {
								self.tableData = r.message;
								self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
								container.find("#mis-records-count").text(`${r.message.length} records`);
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
								self.renderZoneFilterTags(container, dashboardInstance);
							}
							container.find("#mis-controls, #mis-table-container, #mis-kpi-container, #mis-zone-filter-row").show();
						}
					});
					self.attachReportEventHandlers(container, dashboardInstance);
				},
				attachReportEventHandlers: function(container, dashboardInstance) {
					const self = this;
					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").each(function () {
							const btn = $(this);
							const isActive = btn.data("format") === format;
							btn.css("background", isActive ? "#417d81" : "#e2e8f0");
							btn.css("color", isActive ? "white" : "#475569");
						});
						if (self.tableData && self.tableData.length > 0) {
							self.switchFormat(format, container, dashboardInstance);
						}
					});
					let searchTimeout;
					container.off("input", "#mis-search").on("input", "#mis-search", function () {
						clearTimeout(searchTimeout);
						searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (self.tableData) {
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
							}
						}, 300);
					});
					container.off("click", "#mis-expand-toggle").on("click", "#mis-expand-toggle", function () {
						self.allExpanded = !self.allExpanded;
						const expand = self.allExpanded;
						if (!self.tableData) return;
						const zoneData = self.aggregateByZone();
						zoneData.forEach(z => {
							self.expandedZones[z.zone] = expand;
							z.regions.forEach(r => {
								self.expandedRegions[z.zone + "::" + r.region] = expand;
								r.districts.forEach(d => {
									self.expandedDistricts[z.zone + "::" + r.region + "::" + d.district] = expand;
									d.branches.forEach(b => {
										self.expandedBranches[z.zone + "::" + r.region + "::" + d.district + "::" + b.sol_id] = expand;
									});
								});
							});
						});
						$(this).text(expand ? "▲ Collapse All" : "▼ Expand All");
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.refetchData(container, dashboardInstance);
					});
				},
				renderKPI: function(container, dashboardInstance) {
					const self = this;
					const data = self.tableData || [];
					const totalNewAccounts = data.reduce((s, r) => s + (parseInt(r.new_ac) || 0), 0);
					const totalDepositAmount = data.reduce((s, r) => s + (parseFloat(r.deposit_amount) || 0.0), 0.0);
					const avgDeposit = totalNewAccounts > 0 ? (totalDepositAmount / totalNewAccounts) : 0.0;
					const activeBranches = [...new Set(data.map(r => r.sol_id).filter(Boolean))].length;
					const activeAuthorizers = [...new Set(data.map(r => r.auth_id).filter(Boolean))].length;

					const fmtCount = (val) => {
						if (!val && val !== 0) return "0";
						const format = dashboardInstance.state.formatMode || "number";
						if (format === "words") {
							if (val >= 10000000) return (val / 10000000).toFixed(2) + " Cr";
							if (val >= 100000) return (val / 100000).toFixed(2) + " L";
							if (val >= 1000) return (val / 1000).toFixed(2) + " K";
						}
						return new Intl.NumberFormat("en-IN").format(val);
					};

					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const kpiCards = [
						{ label: "New Accounts", value: fmtCount(totalNewAccounts), color: "#3b82f6", bg: "#eff6ff", icon: "📊" },
						{ label: "Total Deposit Amt", value: fmtAmt(totalDepositAmount), color: "#10b981", bg: "#ecfdf5", icon: "💰" },
						{ label: "Avg Deposit/Ac", value: fmtAmt(avgDeposit), color: "#8b5cf6", bg: "#f5f3ff", icon: "📈" },
						{ label: "Active Branches", value: fmtCount(activeBranches), color: "#06b6d4", bg: "#ecfeff", icon: "🏢" },
						{ label: "Active Authorizers", value: fmtCount(activeAuthorizers), color: "#f97316", bg: "#fff7ed", icon: "👥" }
					];

					container.html(`
						<style>
							#new-ac-kpi-container { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
							#new-ac-kpi-container .kpi-card { flex: 1 1 180px; min-width: 150px; border-radius: 10px; padding: 16px 18px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); box-sizing: border-box; min-height: 100px; }
							#new-ac-kpi-container .kpi-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
							#new-ac-kpi-container .kpi-icon { font-size: 20px; flex-shrink: 0; line-height: 1; }
							#new-ac-kpi-container .kpi-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Inter', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
							#new-ac-kpi-container .kpi-value { font-size: clamp(18px, 2.2vw, 24px); font-weight: 800; font-family: 'Inter', sans-serif; line-height: 1.2; word-break: break-word; }
							@media (max-width: 768px) { #new-ac-kpi-container .kpi-card { flex: 1 1 140px; min-width: 120px; padding: 12px 14px; min-height: 80px; } #new-ac-kpi-container .kpi-value { font-size: 16px; } }
							@media (max-width: 480px) { #new-ac-kpi-container .kpi-card { flex: 1 1 100%; min-width: unset; } }
						</style>
						<div id="new-ac-kpi-container">
							${kpiCards.map(card => `<div class="kpi-card" style="background: ${card.bg}; border-left: 4px solid ${card.color};"><div class="kpi-card-header"><span class="kpi-icon">${card.icon}</span><span class="kpi-label">${card.label}</span></div><div class="kpi-value" style="color: ${card.color};">${card.value}</div></div>`).join('')}
						</div>
					`);
				},
				refetchData: function(container, dashboardInstance) {
					const self = this;
					self.tableData = [];
					self.expandedZones = {};
					self.expandedRegions = {};
					self.expandedDistricts = {};
					self.expandedBranches = {};
					self.checkedRows = {};
					self.searchTerm = "";
					self.allExpanded = false;
					self.selectedMisZones = [];
					dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
					self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
				},
				switchFormat: function(format, container, dashboardInstance) {
					const self = this;
					if (self.tableData && self.tableData.length > 0) {
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					}
					self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
				},
				renderZoneFilterTags: function(container, dashboardInstance) {
					const self = this;
					if (!self.tableData || self.tableData.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					let zones = [...new Set(self.tableData.map(r => r.zone).filter(Boolean))].sort();
					if (zones.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					const allSelected = self.selectedMisZones.length === 0;
					let html = '<span style="font-weight: 600; color: #475569; font-size: 13px; white-space: nowrap;">Zone:</span>';
					html += `<button class="mis-zone-filter-tag ${allSelected ? "active" : ""}" data-zone="all" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${allSelected ? "#417d81" : "#fff"}; color: ${allSelected ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">All</button>`;
					zones.forEach(zone => {
						const active = self.selectedMisZones.includes(zone);
						html += `<button class="mis-zone-filter-tag ${active ? "active" : ""}" data-zone="${zone}" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${active ? "#417d81" : "#fff"}; color: ${active ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">${zone}</button>`;
					});
					const $row = container.find("#mis-zone-filter-row");
					$row.html(html).css("display", "flex").css({ "align-items": "center", "gap": "8px", "flex-wrap": "wrap", "margin-bottom": "10px" });
					container.off("click", ".mis-zone-filter-tag").on("click", ".mis-zone-filter-tag", function () {
						const zone = $(this).data("zone");
						if (zone === "all") {
							self.selectedMisZones = [];
						} else {
							const idx = self.selectedMisZones.indexOf(zone);
							if (idx > -1) { self.selectedMisZones.splice(idx, 1); } else { self.selectedMisZones.push(zone); }
						}
						self.renderZoneFilterTags(container, dashboardInstance);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
				},
				aggregateByZone: function() {
					const self = this;
					let data = self.tableData || [];
					const term = (self.searchTerm || "").trim().toLowerCase();
					if (term) {
						data = data.filter(row => {
							const zone = (row.zone || "").toLowerCase();
							const region = (row.region || "").toLowerCase();
							const district = (row.district || "").toLowerCase();
							const sol = (row.sol_desc || row.sol_id || "").toLowerCase();
							const solId = (row.sol_id || "").toLowerCase();
							const authId = (row.auth_id || "").toLowerCase();
							const authName = (row.auth_name || "").toLowerCase();
							const designation = (row.designation || "").toLowerCase();
							return zone.includes(term) || region.includes(term) || district.includes(term) || sol.includes(term) || solId.includes(term) || authId.includes(term) || authName.includes(term) || designation.includes(term);
						});
					}
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						data = data.filter(row => self.selectedMisZones.includes(row.zone));
					}
					const zoneMap = {};
					data.forEach(row => {
						const zone = row.zone || "Unknown";
						const region = row.region || "Unknown";
						const district = row.district || "Unknown";
						const solId = row.sol_id || "Unknown";
						const solDesc = row.sol_desc || row.sol_id || "Unknown";
						
						if (!zoneMap[zone]) {
							zoneMap[zone] = { zone, regions: {}, new_ac: 0, deposit_amount: 0.0, branches_count: new Set() };
						}
						if (!zoneMap[zone].regions[region]) {
							zoneMap[zone].regions[region] = { region, districts: {}, new_ac: 0, deposit_amount: 0.0, branches_count: new Set() };
						}
						if (!zoneMap[zone].regions[region].districts[district]) {
							zoneMap[zone].regions[region].districts[district] = { district, branches: {}, new_ac: 0, deposit_amount: 0.0 };
						}
						if (!zoneMap[zone].regions[region].districts[district].branches[solId]) {
							zoneMap[zone].regions[region].districts[district].branches[solId] = { 
								sol_id: solId, 
								sol_desc: solDesc, 
								authorizers: [], 
								new_ac: 0, 
								deposit_amount: 0.0 
							};
						}
						
						const branchObj = zoneMap[zone].regions[region].districts[district].branches[solId];
						branchObj.authorizers.push(row);
						
						const new_ac = parseInt(row.new_ac || 0);
						const dep_amt = parseFloat(row.deposit_amount || 0);
						
						branchObj.new_ac += new_ac;
						branchObj.deposit_amount += dep_amt;
						
						zoneMap[zone].regions[region].districts[district].new_ac += new_ac;
						zoneMap[zone].regions[region].districts[district].deposit_amount += dep_amt;
						
						zoneMap[zone].regions[region].new_ac += new_ac;
						zoneMap[zone].regions[region].deposit_amount += dep_amt;
						zoneMap[zone].regions[region].branches_count.add(solId);
						
						zoneMap[zone].new_ac += new_ac;
						zoneMap[zone].deposit_amount += dep_amt;
						zoneMap[zone].branches_count.add(solId);
					});
					
					const sortedZones = Object.keys(zoneMap).sort();
					const result = [];
					sortedZones.forEach(zoneName => {
						const zd = zoneMap[zoneName];
						const sortedRegions = Object.keys(zd.regions).sort();
						const regions = sortedRegions.map(rn => {
							const rd = zd.regions[rn];
							const sortedDistricts = Object.keys(rd.districts).sort();
							const districts = sortedDistricts.map(dn => {
								const dd = rd.districts[dn];
								const sortedBranches = Object.keys(dd.branches).sort();
								const branches = sortedBranches.map(bn => dd.branches[bn]);
								return { district: dn, data: dd, branches: branches };
							});
							return { region: rn, data: rd, districts: districts };
						});
						result.push({ zone: zoneName, data: zd, regions: regions });
					});
					return result;
				},
				renderMisTable: function(tableContainer, dashboardInstance) {
					const self = this;
					const format = dashboardInstance.state.formatMode || "number";
					const fmtCount = (val) => {
						if (!val && val !== 0) return "0";
						if (format === "words") {
							if (val >= 10000000) return (val / 10000000).toFixed(2) + " Cr";
							if (val >= 100000) return (val / 100000).toFixed(2) + " L";
							if (val >= 1000) return (val / 1000).toFixed(2) + " K";
						}
						return new Intl.NumberFormat("en-IN").format(val);
					};

					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const zoneData = self.aggregateByZone();
					const totalFilteredNewAc = zoneData.reduce((s, z) => s + z.data.new_ac, 0);
					const totalAllNewAc = (self.tableData || []).reduce((s, r) => s + (parseInt(r.new_ac) || 0), 0);
					const $badge = tableContainer.parent().find("#mis-records-count");
					$badge.text(totalFilteredNewAc + " / " + totalAllNewAc + " accounts" + (self.searchTerm ? " (filtered)" : ""));
					if (totalFilteredNewAc === totalAllNewAc && !self.searchTerm) $badge.hide(); else $badge.show();

					if (!zoneData || zoneData.length === 0) {
						tableContainer.html('<div style="padding: 30px; text-align: center; color: #64748b; font-weight: 600; font-family: \'Inter\', sans-serif;">No data to display.</div>');
						return;
					}

					const grandTotal = { new_ac: 0, deposit_amount: 0.0 };
					zoneData.forEach(z => {
						grandTotal.new_ac += z.data.new_ac;
						grandTotal.deposit_amount += z.data.deposit_amount;
					});

					let sr = 0;
					let rowsHtml = "";
					zoneData.forEach(z => {
						sr++;
						const zoneExpanded = self.expandedZones[z.zone];
						const zoneRow = z.data;
						const zoneChecked = self.checkedRows["zone::" + z.zone];
						
						rowsHtml += `<tr class="mis-zone-row${zoneChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-check-id="zone::${z.zone}" style="cursor: pointer; background: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
							<td style="padding: 10px 14px; text-align: center; white-space: nowrap; width: 30px; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="zone::${z.zone}" ${zoneChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; width: 40px; font-size: 14px;">${sr}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; white-space: nowrap; font-size: 14px;"><span class="mis-zone-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #64748b;">${zoneExpanded ? "▼" : "▶"}</span>${z.zone}</td>
							<td></td>
							<td></td>
							<td></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px;">${fmtCount(zoneRow.new_ac)}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: right; white-space: nowrap; font-size: 14px; background: #e2e8f0;">${fmtAmt(zoneRow.deposit_amount)}</td>
						</tr>`;

						z.regions.forEach(regionObj => {
							const region = regionObj.region;
							const regionRow = regionObj.data;
							const regionKey = z.zone + "::" + region;
							const regionExpanded = self.expandedRegions[regionKey];
							const regionChecked = self.checkedRows[regionKey];
							
							rowsHtml += `<tr class="mis-region-row${regionChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-check-id="${regionKey}" style="display: ${zoneExpanded ? "table-row" : "none"}; cursor: pointer; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
								<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${regionKey}" ${regionChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
								<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
								<td style="padding: 8px 14px; color: #334155; white-space: nowrap; font-size: 14px; padding-left: 24px; font-weight: 600;"><span class="mis-region-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #94a3b8;">${regionExpanded ? "▼" : "▶"}</span>${region}</td>
								<td></td>
								<td></td>
								<td></td>
								<td style="padding: 8px 14px; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtCount(regionRow.new_ac)}</td>
								<td style="padding: 8px 14px; color: #334155; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f1f5f9;">${fmtAmt(regionRow.deposit_amount)}</td>
							</tr>`;

							regionObj.districts.forEach(districtObj => {
								const district = districtObj.district;
								const districtKey = z.zone + "::" + region + "::" + district;
								const districtExpanded = self.expandedDistricts[districtKey];
								const districtChecked = self.checkedRows[districtKey];
								const showDistrict = zoneExpanded && regionExpanded;

								rowsHtml += `<tr class="mis-district-row${districtChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-check-id="${districtKey}" style="display: ${showDistrict ? "table-row" : "none"}; cursor: pointer; background: #fafaf9; border-bottom: 1px solid #e7e5e4;">
									<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${districtKey}" ${districtChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
									<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
									<td style="padding: 8px 14px; color: #44403c; white-space: nowrap; font-size: 14px; padding-left: 42px; font-weight: 600;"><span class="mis-district-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #a8a29e;">${districtExpanded ? "▼" : "▶"}</span>${district}</td>
									<td></td>
									<td></td>
									<td></td>
									<td style="padding: 8px 14px; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtCount(districtObj.data.new_ac)}</td>
									<td style="padding: 8px 14px; color: #44403c; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f5f5f4;">${fmtAmt(districtObj.data.deposit_amount)}</td>
								</tr>`;

								districtObj.branches.forEach((branch, bnIndex) => {
									const branchKey = districtKey + "::" + branch.sol_id;
									const branchExpanded = self.expandedBranches[branchKey];
									const branchChecked = self.checkedRows[branchKey];
									const showBranch = zoneExpanded && regionExpanded && districtExpanded;

									rowsHtml += `<tr class="mis-branch-row${branchChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-branch="${branch.sol_id}" data-check-id="${branchKey}" style="display: ${showBranch ? "table-row" : "none"}; cursor: pointer; background: #ffffff; border-bottom: 1px solid #e2e8f0;">
										<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${branchKey}" ${branchChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
										<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
										<td style="padding: 6px 14px; color: #475569; white-space: nowrap; font-size: 14px; padding-left: 60px; font-weight: 600;"><span class="mis-branch-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #cbd5e1;">${branchExpanded ? "▼" : "▶"}</span>${branch.sol_id} - ${branch.sol_desc}</td>
										<td></td>
										<td></td>
										<td></td>
										<td style="padding: 6px 14px; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtCount(branch.new_ac)}</td>
										<td style="padding: 6px 14px; color: #475569; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f8fafc;">${fmtAmt(branch.deposit_amount)}</td>
									</tr>`;

									branch.authorizers.forEach((auth, ai) => {
										const showAuth = zoneExpanded && regionExpanded && districtExpanded && branchExpanded;
										const authBg = ai % 2 === 0 ? "#fafafa" : "#f5f5f5";
										const authKey = branchKey + "::" + auth.auth_id;
										const authChecked = self.checkedRows[authKey];
										
										rowsHtml += `<tr class="mis-auth-row${authChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-branch="${branch.sol_id}" data-check-id="${authKey}" style="display: ${showAuth ? "table-row" : "none"}; background: ${authBg}; border-bottom: 1px solid #f1f5f9;">
											<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${authKey}" ${authChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
											<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
											<td style="padding: 6px 14px; color: #94a3b8; white-space: nowrap; font-size: 14px; padding-left: 78px; font-weight: 500;">└─</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.auth_id}</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.auth_name}</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.designation || ""}</td>
											<td style="padding: 6px 14px; color: #0d9488; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtCount(auth.new_ac)}</td>
											<td style="padding: 6px 14px; color: #64748b; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(auth.deposit_amount)}</td>
										</tr>`;
									});
								});
							});
						});
					});

					const tableHtml = `
						<style>
							#mis-new-ac-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
							#mis-new-ac-table thead { position: sticky; top: 0; z-index: 2; }
							#mis-new-ac-table tfoot { position: sticky; bottom: 0; z-index: 2; }
							#mis-new-ac-table tfoot tr { box-shadow: 0 -2px 6px rgba(0,0,0,0.1); }
							#mis-new-ac-table tbody tr { transition: background-color 0.2s ease; border-bottom: 1px solid #e2e8f0; }
							#mis-new-ac-table tbody tr:hover { background: #dcfce7 !important; }
							#mis-new-ac-table tbody tr.mis-row-checked { background: #bbf7d0 !important; }
							#mis-new-ac-table tbody tr.mis-zone-row.mis-row-checked,
							#mis-new-ac-table tbody tr.mis-region-row.mis-row-checked,
							#mis-new-ac-table tbody tr.mis-district-row.mis-row-checked,
							#mis-new-ac-table tbody tr.mis-branch-row.mis-row-checked,
							#mis-new-ac-table tbody tr.mis-auth-row.mis-row-checked { background: #86efac !important; }
							#mis-scroll-area { max-height: 550px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
						</style>
						<div id="mis-scroll-area">
							<table id="mis-new-ac-table">
								<thead><tr style="background: linear-gradient(180deg, #3d7579 0%, #346569 100%); color: #ffffff;">
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 30px;"><input type="checkbox" class="mis-check-all" style="cursor: pointer; width: 14px; height: 14px;"></th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 40px;">Sr</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap;">Z / R / D / SOL Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 120px;">Auth ID</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 180px;">Auth Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 150px;">Designation</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 120px;">New Ac</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; white-space: nowrap; width: 180px;">Deposit Amount</th>
								</tr></thead>
								<tbody>${rowsHtml}</tbody>
								<tfoot><tr style="background: #1e293b; color: #ffffff; font-weight: 700;">
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: left; white-space: nowrap; font-size: 14px;">TOTAL</td>
									<td></td>
									<td></td>
									<td></td>
									<td style="padding: 10px 12px; text-align: center; white-space: nowrap; font-size: 14px;">${fmtCount(grandTotal.new_ac)}</td>
									<td style="padding: 10px 12px; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(grandTotal.deposit_amount)}</td>
								</tr></tfoot>
							</table>
						</div>`;
					tableContainer.html(tableHtml);

					// Attach folding handlers
					tableContainer.off("click", ".mis-zone-row").on("click", ".mis-zone-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						self.expandedZones[zone] = !self.expandedZones[zone];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-region-row").on("click", ".mis-region-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const key = zone + "::" + region;
						self.expandedRegions[key] = !self.expandedRegions[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-district-row").on("click", ".mis-district-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const key = zone + "::" + region + "::" + district;
						self.expandedDistricts[key] = !self.expandedDistricts[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-branch-row").on("click", ".mis-branch-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const branch = $(this).data("branch");
						const key = zone + "::" + region + "::" + district + "::" + branch;
						self.expandedBranches[key] = !self.expandedBranches[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					// Attach checkbox handlers
					tableContainer.off("change", ".mis-row-check").on("change", ".mis-row-check", function () {
						const checkId = $(this).data("check-id");
						const checked = $(this).prop("checked");
						self.checkedRows[checkId] = checked;
						const tr = $(this).closest("tr");
						if (checked) tr.addClass("mis-row-checked"); else tr.removeClass("mis-row-checked");
					});

					tableContainer.off("change", ".mis-check-all").on("change", ".mis-check-all", function () {
						const checked = $(this).prop("checked");
						tableContainer.find(".mis-row-check").each(function () {
							$(this).prop("checked", checked).trigger("change");
						});
					});
				}
			},
			{	id: "staff_wise_demand_collection",
				name: "Staff Wise Demand Vs Collection Report",
				tableData: [],
				expandedZones: {},
				expandedRegions: {},
				expandedDistricts: {},
				expandedBranches: {},
				checkedRows: {},
				searchTerm: "",
				allExpanded: false,
				selectedMisZones: [],
				render: function(container, dashboardInstance, seq) {
					const self = this;
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<input type="text" id="mis-search" placeholder="Search branch, SOL ID, district or authorizer..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 200px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="mis-expand-toggle" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">▼ Expand All</button>
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
								<span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
								<div class="btn-group mis-format-toggle" role="group">
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
								</div>
							</div>
							<div style="font-size: 13px; font-weight: 700; color: #417d81; background: rgba(65,125,129,0.08); padding: 6px 12px; border-radius: 6px;" id="mis-records-count"></div>
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							${dashboardInstance.buildMisSkeletonTable("Loading Staff Wise Demand Vs Collection...")}
						</div>
						<div id="mis-zone-filter-row" style="display: none; margin-bottom: 10px;"></div>
						<div id="mis-kpi-container" ${self.tableData && self.tableData.length ? "" : 'style="display: none;"'}></div>
						<div id="mis-table-container" ${self.tableData ? "" : 'style="display: none;"'}></div>
					`);

					if (self.tableData && self.tableData.length > 0) {
						self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
						container.find("#mis-records-count").text(`${self.tableData.length} records`);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
						container.find("#mis-controls, #mis-table-container, #mis-kpi-container").show();
						container.find("#mis-loading").hide();
						self.attachReportEventHandlers(container, dashboardInstance);
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_staff_wise_demand_collection_data",
						args: { selected_date: dashboardInstance.state.selectedDate },
						callback: function(r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							container.find("#mis-loading").hide();
							if (r.message && r.message.length) {
								self.tableData = r.message;
								self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
								container.find("#mis-records-count").text(`${r.message.length} records`);
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
								self.renderZoneFilterTags(container, dashboardInstance);
							}
							container.find("#mis-controls, #mis-table-container, #mis-kpi-container, #mis-zone-filter-row").show();
						}
					});
					self.attachReportEventHandlers(container, dashboardInstance);
				},
				attachReportEventHandlers: function(container, dashboardInstance) {
					const self = this;
					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").each(function () {
							const btn = $(this);
							const isActive = btn.data("format") === format;
							btn.css("background", isActive ? "#417d81" : "#e2e8f0");
							btn.css("color", isActive ? "white" : "#475569");
						});
						if (self.tableData && self.tableData.length > 0) {
							self.switchFormat(format, container, dashboardInstance);
						}
					});
					let searchTimeout;
					container.off("input", "#mis-search").on("input", "#mis-search", function () {
						clearTimeout(searchTimeout);
						searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (self.tableData) {
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
							}
						}, 300);
					});
					container.off("click", "#mis-expand-toggle").on("click", "#mis-expand-toggle", function () {
						self.allExpanded = !self.allExpanded;
						const expand = self.allExpanded;
						if (!self.tableData) return;
						const zoneData = self.aggregateByZone();
						zoneData.forEach(z => {
							self.expandedZones[z.zone] = expand;
							z.regions.forEach(r => {
								self.expandedRegions[z.zone + "::" + r.region] = expand;
								r.districts.forEach(d => {
									self.expandedDistricts[z.zone + "::" + r.region + "::" + d.district] = expand;
									d.branches.forEach(b => {
										self.expandedBranches[z.zone + "::" + r.region + "::" + d.district + "::" + b.sol_id] = expand;
									});
								});
							});
						});
						$(this).text(expand ? "▲ Collapse All" : "▼ Expand All");
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.refetchData(container, dashboardInstance);
					});
				},
				renderKPI: function(container, dashboardInstance) {
					const self = this;
					const data = self.tableData || [];
					const totalDemand = data.reduce((s, r) => s + (parseFloat(r.monthly_demand_amount) || 0.0), 0.0);
					const totalCollection = data.reduce((s, r) => s + (parseFloat(r.monthly_collection) || 0.0), 0.0);
					const overallPct = totalDemand > 0 ? ((totalCollection / totalDemand) * 100).toFixed(2) + "%" : "0.00%";
					const activeBranches = [...new Set(data.map(r => r.sol_id).filter(Boolean))].length;
					const activeAuthorizers = [...new Set(data.map(r => r.auth_id).filter(Boolean))].length;

					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						const format = dashboardInstance.state.formatMode || "number";
						if (format === "words") {
							if (n >= 10000000) return "₹ " + (n / 10000000).toFixed(2) + " Cr";
							if (n >= 100000) return "₹ " + (n / 100000).toFixed(2) + " L";
							if (n >= 1000) return "₹ " + (n / 1000).toFixed(2) + " K";
						}
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const fmtCount = (val) => {
						return new Intl.NumberFormat("en-IN").format(val);
					};

					const kpiCards = [
						{ label: "Total Demand", value: fmtAmt(totalDemand), color: "#3b82f6", bg: "#eff6ff", icon: "📊" },
						{ label: "Total Collection", value: fmtAmt(totalCollection), color: "#10b981", bg: "#ecfdf5", icon: "💰" },
						{ label: "Collection %", value: overallPct, color: "#8b5cf6", bg: "#f5f3ff", icon: "📈" },
						{ label: "Active Branches", value: fmtCount(activeBranches), color: "#06b6d4", bg: "#ecfeff", icon: "🏢" },
						{ label: "Active Authorizers", value: fmtCount(activeAuthorizers), color: "#f97316", bg: "#fff7ed", icon: "👥" }
					];

					container.html(`
						<style>
							#demand-coll-kpi-container { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
							#demand-coll-kpi-container .kpi-card { flex: 1 1 180px; min-width: 150px; border-radius: 10px; padding: 16px 18px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); box-sizing: border-box; min-height: 100px; }
							#demand-coll-kpi-container .kpi-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
							#demand-coll-kpi-container .kpi-icon { font-size: 20px; flex-shrink: 0; line-height: 1; }
							#demand-coll-kpi-container .kpi-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Inter', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
							#demand-coll-kpi-container .kpi-value { font-size: clamp(18px, 2.2vw, 24px); font-weight: 800; font-family: 'Inter', sans-serif; line-height: 1.2; word-break: break-word; }
							@media (max-width: 768px) { #demand-coll-kpi-container .kpi-card { flex: 1 1 140px; min-width: 120px; padding: 12px 14px; min-height: 80px; } #demand-coll-kpi-container .kpi-value { font-size: 16px; } }
							@media (max-width: 480px) { #demand-coll-kpi-container .kpi-card { flex: 1 1 100%; min-width: unset; } }
						</style>
						<div id="demand-coll-kpi-container">
							${kpiCards.map(card => `<div class="kpi-card" style="background: ${card.bg}; border-left: 4px solid ${card.color};"><div class="kpi-card-header"><span class="kpi-icon">${card.icon}</span><span class="kpi-label">${card.label}</span></div><div class="kpi-value" style="color: ${card.color};">${card.value}</div></div>`).join('')}
						</div>
					`);
				},
				refetchData: function(container, dashboardInstance) {
					const self = this;
					self.tableData = [];
					self.expandedZones = {};
					self.expandedRegions = {};
					self.expandedDistricts = {};
					self.expandedBranches = {};
					self.checkedRows = {};
					self.searchTerm = "";
					self.allExpanded = false;
					self.selectedMisZones = [];
					dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
					self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
				},
				switchFormat: function(format, container, dashboardInstance) {
					const self = this;
					if (self.tableData && self.tableData.length > 0) {
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					}
					self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
				},
				renderZoneFilterTags: function(container, dashboardInstance) {
					const self = this;
					if (!self.tableData || self.tableData.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					let zones = [...new Set(self.tableData.map(r => r.zone).filter(Boolean))].sort();
					if (zones.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					const allSelected = self.selectedMisZones.length === 0;
					let html = '<span style="font-weight: 600; color: #475569; font-size: 13px; white-space: nowrap;">Zone:</span>';
					html += `<button class="mis-zone-filter-tag ${allSelected ? "active" : ""}" data-zone="all" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${allSelected ? "#417d81" : "#fff"}; color: ${allSelected ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">All</button>`;
					zones.forEach(zone => {
						const active = self.selectedMisZones.includes(zone);
						html += `<button class="mis-zone-filter-tag ${active ? "active" : ""}" data-zone="${zone}" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${active ? "#417d81" : "#fff"}; color: ${active ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">${zone}</button>`;
					});
					const $row = container.find("#mis-zone-filter-row");
					$row.html(html).css("display", "flex").css({ "align-items": "center", "gap": "8px", "flex-wrap": "wrap", "margin-bottom": "10px" });
					container.off("click", ".mis-zone-filter-tag").on("click", ".mis-zone-filter-tag", function () {
						const zone = $(this).data("zone");
						if (zone === "all") {
							self.selectedMisZones = [];
						} else {
							const idx = self.selectedMisZones.indexOf(zone);
							if (idx > -1) { self.selectedMisZones.splice(idx, 1); } else { self.selectedMisZones.push(zone); }
						}
						self.renderZoneFilterTags(container, dashboardInstance);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
				},
				aggregateByZone: function() {
					const self = this;
					let data = self.tableData || [];
					const term = (self.searchTerm || "").trim().toLowerCase();
					if (term) {
						data = data.filter(row => {
							const zone = (row.zone || "").toLowerCase();
							const region = (row.region || "").toLowerCase();
							const district = (row.district || "").toLowerCase();
							const sol = (row.sol_desc || row.sol_id || "").toLowerCase();
							const solId = (row.sol_id || "").toLowerCase();
							const authId = (row.auth_id || "").toLowerCase();
							const authName = (row.auth_name || "").toLowerCase();
							const designation = (row.designation || "").toLowerCase();
							return zone.includes(term) || region.includes(term) || district.includes(term) || sol.includes(term) || solId.includes(term) || authId.includes(term) || authName.includes(term) || designation.includes(term);
						});
					}
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						data = data.filter(row => self.selectedMisZones.includes(row.zone));
					}
					const zoneMap = {};
					data.forEach(row => {
						const zone = row.zone || "Unknown";
						const region = row.region || "Unknown";
						const district = row.district || "Unknown";
						const solId = row.sol_id || "Unknown";
						const solDesc = row.sol_desc || row.sol_id || "Unknown";
						
						if (!zoneMap[zone]) {
							zoneMap[zone] = { zone, regions: {}, monthly_demand_amount: 0.0, monthly_collection: 0.0, branches_count: new Set() };
						}
						if (!zoneMap[zone].regions[region]) {
							zoneMap[zone].regions[region] = { region, districts: {}, monthly_demand_amount: 0.0, monthly_collection: 0.0, branches_count: new Set() };
						}
						if (!zoneMap[zone].regions[region].districts[district]) {
							zoneMap[zone].regions[region].districts[district] = { district, branches: {}, monthly_demand_amount: 0.0, monthly_collection: 0.0 };
						}
						if (!zoneMap[zone].regions[region].districts[district].branches[solId]) {
							zoneMap[zone].regions[region].districts[district].branches[solId] = { 
								sol_id: solId, 
								sol_desc: solDesc, 
								authorizers: [], 
								monthly_demand_amount: 0.0, 
								monthly_collection: 0.0 
							};
						}
						
						const branchObj = zoneMap[zone].regions[region].districts[district].branches[solId];
						branchObj.authorizers.push(row);
						
						const demand = parseFloat(row.monthly_demand_amount || 0);
						const collection = parseFloat(row.monthly_collection || 0);
						
						branchObj.monthly_demand_amount += demand;
						branchObj.monthly_collection += collection;
						
						zoneMap[zone].regions[region].districts[district].monthly_demand_amount += demand;
						zoneMap[zone].regions[region].districts[district].monthly_collection += collection;
						
						zoneMap[zone].regions[region].monthly_demand_amount += demand;
						zoneMap[zone].regions[region].monthly_collection += collection;
						zoneMap[zone].regions[region].branches_count.add(solId);
						
						zoneMap[zone].monthly_demand_amount += demand;
						zoneMap[zone].monthly_collection += collection;
						zoneMap[zone].branches_count.add(solId);
					});
					
					const sortedZones = Object.keys(zoneMap).sort();
					const result = [];
					sortedZones.forEach(zoneName => {
						const zd = zoneMap[zoneName];
						const sortedRegions = Object.keys(zd.regions).sort();
						const regions = sortedRegions.map(rn => {
							const rd = zd.regions[rn];
							const sortedDistricts = Object.keys(rd.districts).sort();
							const districts = sortedDistricts.map(dn => {
								const dd = rd.districts[dn];
								const sortedBranches = Object.keys(dd.branches).sort();
								const branches = sortedBranches.map(bn => dd.branches[bn]);
								return { district: dn, data: dd, branches: branches };
							});
							return { region: rn, data: rd, districts: districts };
						});
						result.push({ zone: zoneName, data: zd, regions: regions });
					});
					return result;
				},
				renderMisTable: function(tableContainer, dashboardInstance) {
					const self = this;
					const format = dashboardInstance.state.formatMode || "number";

					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						if (format === "words") {
							if (n >= 10000000) return "₹ " + (n / 10000000).toFixed(2) + " Cr";
							if (n >= 100000) return "₹ " + (n / 100000).toFixed(2) + " L";
							if (n >= 1000) return "₹ " + (n / 1000).toFixed(2) + " K";
						}
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const fmtPct = (coll, dem) => {
						const d = parseFloat(dem);
						const c = parseFloat(coll);
						if (!d || d <= 0) return "0.00%";
						return ((c / d) * 100).toFixed(2) + "%";
					};

					const zoneData = self.aggregateByZone();
					const totalFilteredDemand = zoneData.reduce((s, z) => s + z.data.monthly_demand_amount, 0);
					const totalAllDemand = (self.tableData || []).reduce((s, r) => s + (parseFloat(r.monthly_demand_amount) || 0), 0);
					const $badge = tableContainer.parent().find("#mis-records-count");
					$badge.text(fmtAmt(totalFilteredDemand) + " / " + fmtAmt(totalAllDemand) + " demand" + (self.searchTerm ? " (filtered)" : ""));
					if (totalFilteredDemand === totalAllDemand && !self.searchTerm) $badge.hide(); else $badge.show();

					if (!zoneData || zoneData.length === 0) {
						tableContainer.html('<div style="padding: 30px; text-align: center; color: #64748b; font-weight: 600; font-family: \'Inter\', sans-serif;">No data to display.</div>');
						return;
					}

					const grandTotal = { monthly_demand_amount: 0.0, monthly_collection: 0.0 };
					zoneData.forEach(z => {
						grandTotal.monthly_demand_amount += z.data.monthly_demand_amount;
						grandTotal.monthly_collection += z.data.monthly_collection;
					});

					let sr = 0;
					let rowsHtml = "";
					zoneData.forEach(z => {
						sr++;
						const zoneExpanded = self.expandedZones[z.zone];
						const zoneRow = z.data;
						const zoneChecked = self.checkedRows["zone::" + z.zone];
						
						rowsHtml += `<tr class="mis-zone-row${zoneChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-check-id="zone::${z.zone}" style="cursor: pointer; background: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
							<td style="padding: 10px 14px; text-align: center; white-space: nowrap; width: 30px; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="zone::${z.zone}" ${zoneChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; width: 40px; font-size: 14px;">${sr}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; white-space: nowrap; font-size: 14px;"><span class="mis-zone-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #64748b;">${zoneExpanded ? "▼" : "▶"}</span>${z.zone}</td>
							<td></td>
							<td></td>
							<td></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(zoneRow.monthly_demand_amount)}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(zoneRow.monthly_collection)}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; background: #e2e8f0;">${fmtPct(zoneRow.monthly_collection, zoneRow.monthly_demand_amount)}</td>
						</tr>`;

						z.regions.forEach(regionObj => {
							const region = regionObj.region;
							const regionRow = regionObj.data;
							const regionKey = z.zone + "::" + region;
							const regionExpanded = self.expandedRegions[regionKey];
							const regionChecked = self.checkedRows[regionKey];
							
							rowsHtml += `<tr class="mis-region-row${regionChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-check-id="${regionKey}" style="display: ${zoneExpanded ? "table-row" : "none"}; cursor: pointer; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
								<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${regionKey}" ${regionChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
								<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
								<td style="padding: 8px 14px; color: #334155; white-space: nowrap; font-size: 14px; padding-left: 24px; font-weight: 600;"><span class="mis-region-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #94a3b8;">${regionExpanded ? "▼" : "▶"}</span>${region}</td>
								<td></td>
								<td></td>
								<td></td>
								<td style="padding: 8px 14px; color: #334155; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(regionRow.monthly_demand_amount)}</td>
								<td style="padding: 8px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(regionRow.monthly_collection)}</td>
								<td style="padding: 8px 14px; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f1f5f9;">${fmtPct(regionRow.monthly_collection, regionRow.monthly_demand_amount)}</td>
							</tr>`;

							regionObj.districts.forEach(districtObj => {
								const district = districtObj.district;
								const districtKey = z.zone + "::" + region + "::" + district;
								const districtExpanded = self.expandedDistricts[districtKey];
								const districtChecked = self.checkedRows[districtKey];
								const showDistrict = zoneExpanded && regionExpanded;

								rowsHtml += `<tr class="mis-district-row${districtChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-check-id="${districtKey}" style="display: ${showDistrict ? "table-row" : "none"}; cursor: pointer; background: #fafaf9; border-bottom: 1px solid #e7e5e4;">
									<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${districtKey}" ${districtChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
									<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
									<td style="padding: 8px 14px; color: #44403c; white-space: nowrap; font-size: 14px; padding-left: 42px; font-weight: 600;"><span class="mis-district-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #a8a29e;">${districtExpanded ? "▼" : "▶"}</span>${district}</td>
									<td></td>
									<td></td>
									<td></td>
									<td style="padding: 8px 14px; color: #44403c; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(districtObj.data.monthly_demand_amount)}</td>
									<td style="padding: 8px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(districtObj.data.monthly_collection)}</td>
									<td style="padding: 8px 14px; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f5f5f4;">${fmtPct(districtObj.data.monthly_collection, districtObj.data.monthly_demand_amount)}</td>
								</tr>`;

								districtObj.branches.forEach((branch, bnIndex) => {
									const branchKey = districtKey + "::" + branch.sol_id;
									const branchExpanded = self.expandedBranches[branchKey];
									const branchChecked = self.checkedRows[branchKey];
									const showBranch = zoneExpanded && regionExpanded && districtExpanded;

									rowsHtml += `<tr class="mis-branch-row${branchChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-branch="${branch.sol_id}" data-check-id="${branchKey}" style="display: ${showBranch ? "table-row" : "none"}; cursor: pointer; background: #ffffff; border-bottom: 1px solid #e2e8f0;">
										<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${branchKey}" ${branchChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
										<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
										<td style="padding: 6px 14px; color: #475569; white-space: nowrap; font-size: 14px; padding-left: 60px; font-weight: 600;"><span class="mis-branch-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #cbd5e1;">${branchExpanded ? "▼" : "▶"}</span>${branch.sol_id} - ${branch.sol_desc}</td>
										<td></td>
										<td></td>
										<td></td>
										<td style="padding: 6px 14px; color: #475569; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(branch.monthly_demand_amount)}</td>
										<td style="padding: 6px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(branch.monthly_collection)}</td>
										<td style="padding: 6px 14px; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f8fafc;">${fmtPct(branch.monthly_collection, branch.monthly_demand_amount)}</td>
									</tr>`;

									branch.authorizers.forEach((auth, ai) => {
										const showAuth = zoneExpanded && regionExpanded && districtExpanded && branchExpanded;
										const authBg = ai % 2 === 0 ? "#fafafa" : "#f5f5f5";
										const authKey = branchKey + "::" + auth.auth_id;
										const authChecked = self.checkedRows[authKey];
										
										rowsHtml += `<tr class="mis-auth-row${authChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-branch="${branch.sol_id}" data-check-id="${authKey}" style="display: ${showAuth ? "table-row" : "none"}; background: ${authBg}; border-bottom: 1px solid #f1f5f9;">
											<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${authKey}" ${authChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
											<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
											<td style="padding: 6px 14px; color: #94a3b8; white-space: nowrap; font-size: 14px; padding-left: 78px; font-weight: 500;">└─</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.auth_id}</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.auth_name}</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.designation || ""}</td>
											<td style="padding: 6px 14px; color: #64748b; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtAmt(auth.monthly_demand_amount)}</td>
											<td style="padding: 6px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtAmt(auth.monthly_collection)}</td>
											<td style="padding: 6px 14px; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtPct(auth.monthly_collection, auth.monthly_demand_amount)}</td>
										</tr>`;
									});
								});
							});
						});
					});

					const tableHtml = `
						<style>
							#mis-new-ac-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
							#mis-new-ac-table thead { position: sticky; top: 0; z-index: 2; }
							#mis-new-ac-table tfoot { position: sticky; bottom: 0; z-index: 2; }
							#mis-new-ac-table tfoot tr { box-shadow: 0 -2px 6px rgba(0,0,0,0.1); }
							#mis-new-ac-table tbody tr { transition: background-color 0.2s ease; border-bottom: 1px solid #e2e8f0; }
							#mis-new-ac-table tbody tr:hover { background: #dcfce7 !important; }
							#mis-new-ac-table tbody tr.mis-row-checked { background: #bbf7d0 !important; }
							#mis-new-ac-table tbody tr.mis-zone-row.mis-row-checked,
							#mis-new-ac-table tbody tr.mis-region-row.mis-row-checked,
							#mis-new-ac-table tbody tr.mis-district-row.mis-row-checked,
							#mis-new-ac-table tbody tr.mis-branch-row.mis-row-checked,
							#mis-new-ac-table tbody tr.mis-auth-row.mis-row-checked { background: #86efac !important; }
							#mis-scroll-area { max-height: 550px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
						</style>
						<div id="mis-scroll-area">
							<table id="mis-new-ac-table">
								<thead><tr style="background: linear-gradient(180deg, #3d7579 0%, #346569 100%); color: #ffffff;">
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 30px;"><input type="checkbox" class="mis-check-all" style="cursor: pointer; width: 14px; height: 14px;"></th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 40px;">Sr</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap;">Z / R / D / SOL Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 120px;">Auth ID</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 180px;">Auth Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 150px;">Designation</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; white-space: nowrap; width: 150px;">Monthly Demand</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; white-space: nowrap; width: 150px;">Sum of Collection</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 120px;">Collection %</th>
								</tr></thead>
								<tbody>${rowsHtml}</tbody>
								<tfoot><tr style="background: #1e293b; color: #ffffff; font-weight: 700;">
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: left; white-space: nowrap; font-size: 14px;">TOTAL</td>
									<td></td>
									<td></td>
									<td></td>
									<td style="padding: 10px 12px; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(grandTotal.monthly_demand_amount)}</td>
									<td style="padding: 10px 12px; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(grandTotal.monthly_collection)}</td>
									<td style="padding: 10px 12px; text-align: center; white-space: nowrap; font-size: 14px;">${fmtPct(grandTotal.monthly_collection, grandTotal.monthly_demand_amount)}</td>
								</tr></tfoot>
							</table>
						</div>`;
					tableContainer.html(tableHtml);

					// Attach folding handlers
					tableContainer.off("click", ".mis-zone-row").on("click", ".mis-zone-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						self.expandedZones[zone] = !self.expandedZones[zone];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-region-row").on("click", ".mis-region-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const key = zone + "::" + region;
						self.expandedRegions[key] = !self.expandedRegions[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-district-row").on("click", ".mis-district-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const key = zone + "::" + region + "::" + district;
						self.expandedDistricts[key] = !self.expandedDistricts[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-branch-row").on("click", ".mis-branch-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const branch = $(this).data("branch");
						const key = zone + "::" + region + "::" + district + "::" + branch;
						self.expandedBranches[key] = !self.expandedBranches[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					// Attach checkbox handlers
					tableContainer.off("change", ".mis-row-check").on("change", ".mis-row-check", function () {
						const checkId = $(this).data("check-id");
						const checked = $(this).prop("checked");
						self.checkedRows[checkId] = checked;
						const tr = $(this).closest("tr");
						if (checked) tr.addClass("mis-row-checked"); else tr.removeClass("mis-row-checked");
					});

					tableContainer.off("change", ".mis-check-all").on("change", ".mis-check-all", function () {
						const checked = $(this).prop("checked");
						tableContainer.find(".mis-row-check").each(function () {
							$(this).prop("checked", checked).trigger("change");
						});
					});
				}
			},
			{	id: "agent_wise_demand_collection",
				name: "Agent Wise Demand Vs Collection Report",
				tableData: [],
				expandedZones: {},
				expandedRegions: {},
				expandedDistricts: {},
				expandedBranches: {},
				checkedRows: {},
				searchTerm: "",
				allExpanded: false,
				selectedMisZones: [],
				render: function(container, dashboardInstance, seq) {
					const self = this;
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<input type="text" id="mis-search" placeholder="Search branch, SOL ID, agent, authorizer..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 200px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="mis-expand-toggle" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">▼ Expand All</button>
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
								<span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
								<div class="btn-group mis-format-toggle" role="group">
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
								</div>
							</div>
							<div style="font-size: 13px; font-weight: 700; color: #417d81; background: rgba(65,125,129,0.08); padding: 6px 12px; border-radius: 6px;" id="mis-records-count"></div>
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							${dashboardInstance.buildMisSkeletonTable("Loading Agent Wise Demand Vs Collection...")}
						</div>
						<div id="mis-zone-filter-row" style="display: none; margin-bottom: 10px;"></div>
						<div id="mis-kpi-container" ${self.tableData && self.tableData.length ? "" : 'style="display: none;"'}></div>
						<div id="mis-table-container" ${self.tableData ? "" : 'style="display: none;"'}></div>
					`);

					if (self.tableData && self.tableData.length > 0) {
						self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
						container.find("#mis-records-count").text(`${self.tableData.length} records`);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
						container.find("#mis-controls, #mis-table-container, #mis-kpi-container").show();
						container.find("#mis-loading").hide();
						self.attachReportEventHandlers(container, dashboardInstance);
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_agent_wise_demand_collection_data",
						args: { selected_date: dashboardInstance.state.selectedDate },
						callback: function(r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							container.find("#mis-loading").hide();
							if (r.message && r.message.length) {
								self.tableData = r.message;
								self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
								container.find("#mis-records-count").text(`${r.message.length} records`);
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
								self.renderZoneFilterTags(container, dashboardInstance);
							}
							container.find("#mis-controls, #mis-table-container, #mis-kpi-container, #mis-zone-filter-row").show();
						}
					});
					self.attachReportEventHandlers(container, dashboardInstance);
				},
				attachReportEventHandlers: function(container, dashboardInstance) {
					const self = this;
					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").each(function () {
							const btn = $(this);
							const isActive = btn.data("format") === format;
							btn.css("background", isActive ? "#417d81" : "#e2e8f0");
							btn.css("color", isActive ? "white" : "#475569");
						});
						if (self.tableData && self.tableData.length > 0) {
							self.switchFormat(format, container, dashboardInstance);
						}
					});
					let searchTimeout;
					container.off("input", "#mis-search").on("input", "#mis-search", function () {
						clearTimeout(searchTimeout);
						searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (self.tableData) {
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
							}
						}, 300);
					});
					container.off("click", "#mis-expand-toggle").on("click", "#mis-expand-toggle", function () {
						self.allExpanded = !self.allExpanded;
						const expand = self.allExpanded;
						if (!self.tableData) return;
						const zoneData = self.aggregateByZone();
						zoneData.forEach(z => {
							self.expandedZones[z.zone] = expand;
							z.regions.forEach(r => {
								self.expandedRegions[z.zone + "::" + r.region] = expand;
								r.districts.forEach(d => {
									self.expandedDistricts[z.zone + "::" + r.region + "::" + d.district] = expand;
									d.branches.forEach(b => {
										self.expandedBranches[z.zone + "::" + r.region + "::" + d.district + "::" + b.sol_id] = expand;
									});
								});
							});
						});
						$(this).text(expand ? "▲ Collapse All" : "▼ Expand All");
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.refetchData(container, dashboardInstance);
					});
				},
				renderKPI: function(container, dashboardInstance) {
					const self = this;
					const data = self.tableData || [];
					const totalDemand = data.reduce((s, r) => s + (parseFloat(r.monthly_demand_amount) || 0.0), 0.0);
					const totalCollection = data.reduce((s, r) => s + (parseFloat(r.monthly_collection) || 0.0), 0.0);
					const overallPct = totalDemand > 0 ? ((totalCollection / totalDemand) * 100).toFixed(2) + "%" : "0.00%";
					const activeBranches = [...new Set(data.map(r => r.sol_id).filter(Boolean))].length;
					const activeAgents = [...new Set(data.map(r => r.rm_id).filter(Boolean))].length;

					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						const format = dashboardInstance.state.formatMode || "number";
						if (format === "words") {
							if (n >= 10000000) return "₹ " + (n / 10000000).toFixed(2) + " Cr";
							if (n >= 100000) return "₹ " + (n / 100000).toFixed(2) + " L";
							if (n >= 1000) return "₹ " + (n / 1000).toFixed(2) + " K";
						}
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const fmtCount = (val) => {
						return new Intl.NumberFormat("en-IN").format(val);
					};

					const kpiCards = [
						{ label: "Total Demand", value: fmtAmt(totalDemand), color: "#3b82f6", bg: "#eff6ff", icon: "📊" },
						{ label: "Total Collection", value: fmtAmt(totalCollection), color: "#10b981", bg: "#ecfdf5", icon: "💰" },
						{ label: "Collection %", value: overallPct, color: "#8b5cf6", bg: "#f5f3ff", icon: "📈" },
						{ label: "Active Branches", value: fmtCount(activeBranches), color: "#06b6d4", bg: "#ecfeff", icon: "🏢" },
						{ label: "Active Agents", value: fmtCount(activeAgents), color: "#f97316", bg: "#fff7ed", icon: "👥" }
					];

					container.html(`
						<style>
							#agent-coll-kpi-container { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
							#agent-coll-kpi-container .kpi-card { flex: 1 1 180px; min-width: 150px; border-radius: 10px; padding: 16px 18px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); box-sizing: border-box; min-height: 100px; }
							#agent-coll-kpi-container .kpi-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
							#agent-coll-kpi-container .kpi-icon { font-size: 20px; flex-shrink: 0; line-height: 1; }
							#agent-coll-kpi-container .kpi-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Inter', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
							#agent-coll-kpi-container .kpi-value { font-size: clamp(18px, 2.2vw, 24px); font-weight: 800; font-family: 'Inter', sans-serif; line-height: 1.2; word-break: break-word; }
							@media (max-width: 768px) { #agent-coll-kpi-container .kpi-card { flex: 1 1 140px; min-width: 120px; padding: 12px 14px; min-height: 80px; } #agent-coll-kpi-container .kpi-value { font-size: 16px; } }
							@media (max-width: 480px) { #agent-coll-kpi-container .kpi-card { flex: 1 1 100%; min-width: unset; } }
						</style>
						<div id="agent-coll-kpi-container">
							${kpiCards.map(card => `<div class="kpi-card" style="background: ${card.bg}; border-left: 4px solid ${card.color};"><div class="kpi-card-header"><span class="kpi-icon">${card.icon}</span><span class="kpi-label">${card.label}</span></div><div class="kpi-value" style="color: ${card.color};">${card.value}</div></div>`).join('')}
						</div>
					`);
				},
				refetchData: function(container, dashboardInstance) {
					const self = this;
					self.tableData = [];
					self.expandedZones = {};
					self.expandedRegions = {};
					self.expandedDistricts = {};
					self.expandedBranches = {};
					self.checkedRows = {};
					self.searchTerm = "";
					self.allExpanded = false;
					self.selectedMisZones = [];
					dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
					self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
				},
				switchFormat: function(format, container, dashboardInstance) {
					const self = this;
					if (self.tableData && self.tableData.length > 0) {
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					}
					self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
				},
				renderZoneFilterTags: function(container, dashboardInstance) {
					const self = this;
					if (!self.tableData || self.tableData.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					let zones = [...new Set(self.tableData.map(r => r.zone).filter(Boolean))].sort();
					if (zones.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					const allSelected = self.selectedMisZones.length === 0;
					let html = '<span style="font-weight: 600; color: #475569; font-size: 13px; white-space: nowrap;">Zone:</span>';
					html += `<button class="mis-zone-filter-tag ${allSelected ? "active" : ""}" data-zone="all" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${allSelected ? "#417d81" : "#fff"}; color: ${allSelected ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">All</button>`;
					zones.forEach(zone => {
						const active = self.selectedMisZones.includes(zone);
						html += `<button class="mis-zone-filter-tag ${active ? "active" : ""}" data-zone="${zone}" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${active ? "#417d81" : "#fff"}; color: ${active ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">${zone}</button>`;
					});
					const $row = container.find("#mis-zone-filter-row");
					$row.html(html).css("display", "flex").css({ "align-items": "center", "gap": "8px", "flex-wrap": "wrap", "margin-bottom": "10px" });
					container.off("click", ".mis-zone-filter-tag").on("click", ".mis-zone-filter-tag", function () {
						const zone = $(this).data("zone");
						if (zone === "all") {
							self.selectedMisZones = [];
						} else {
							const idx = self.selectedMisZones.indexOf(zone);
							if (idx > -1) { self.selectedMisZones.splice(idx, 1); } else { self.selectedMisZones.push(zone); }
						}
						self.renderZoneFilterTags(container, dashboardInstance);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
				},
				aggregateByZone: function() {
					const self = this;
					let data = self.tableData || [];
					const term = (self.searchTerm || "").trim().toLowerCase();
					if (term) {
						data = data.filter(row => {
							const zone = (row.zone || "").toLowerCase();
							const region = (row.region || "").toLowerCase();
							const district = (row.district || "").toLowerCase();
							const sol = (row.sol_desc || row.sol_id || "").toLowerCase();
							const solId = (row.sol_id || "").toLowerCase();
							const rmId = (row.rm_id || "").toLowerCase();
							const rmName = (row.rm_name || "").toLowerCase();
							const authId = (row.auth_id || "").toLowerCase();
							const authName = (row.auth_name || "").toLowerCase();
							const designation = (row.designation || "").toLowerCase();
							return zone.includes(term) || region.includes(term) || district.includes(term) || sol.includes(term) || solId.includes(term) || rmId.includes(term) || rmName.includes(term) || authId.includes(term) || authName.includes(term) || designation.includes(term);
						});
					}
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						data = data.filter(row => self.selectedMisZones.includes(row.zone));
					}
					const zoneMap = {};
					data.forEach(row => {
						const zone = row.zone || "Unknown";
						const region = row.region || "Unknown";
						const district = row.district || "Unknown";
						const solId = row.sol_id || "Unknown";
						const solDesc = row.sol_desc || row.sol_id || "Unknown";
						
						if (!zoneMap[zone]) {
							zoneMap[zone] = { zone, regions: {}, monthly_demand_amount: 0.0, monthly_collection: 0.0, branches_count: new Set() };
						}
						if (!zoneMap[zone].regions[region]) {
							zoneMap[zone].regions[region] = { region, districts: {}, monthly_demand_amount: 0.0, monthly_collection: 0.0, branches_count: new Set() };
						}
						if (!zoneMap[zone].regions[region].districts[district]) {
							zoneMap[zone].regions[region].districts[district] = { district, branches: {}, monthly_demand_amount: 0.0, monthly_collection: 0.0 };
						}
						if (!zoneMap[zone].regions[region].districts[district].branches[solId]) {
							zoneMap[zone].regions[region].districts[district].branches[solId] = { 
								sol_id: solId, 
								sol_desc: solDesc, 
								agents: [], 
								monthly_demand_amount: 0.0, 
								monthly_collection: 0.0 
							};
						}
						
						const branchObj = zoneMap[zone].regions[region].districts[district].branches[solId];
						branchObj.agents.push(row);
						
						const demand = parseFloat(row.monthly_demand_amount || 0);
						const collection = parseFloat(row.monthly_collection || 0);
						
						branchObj.monthly_demand_amount += demand;
						branchObj.monthly_collection += collection;
						
						zoneMap[zone].regions[region].districts[district].monthly_demand_amount += demand;
						zoneMap[zone].regions[region].districts[district].monthly_collection += collection;
						
						zoneMap[zone].regions[region].monthly_demand_amount += demand;
						zoneMap[zone].regions[region].monthly_collection += collection;
						zoneMap[zone].regions[region].branches_count.add(solId);
						
						zoneMap[zone].monthly_demand_amount += demand;
						zoneMap[zone].monthly_collection += collection;
						zoneMap[zone].branches_count.add(solId);
					});
					
					const sortedZones = Object.keys(zoneMap).sort();
					const result = [];
					sortedZones.forEach(zoneName => {
						const zd = zoneMap[zoneName];
						const sortedRegions = Object.keys(zd.regions).sort();
						const regions = sortedRegions.map(rn => {
							const rd = zd.regions[rn];
							const sortedDistricts = Object.keys(rd.districts).sort();
							const districts = sortedDistricts.map(dn => {
								const dd = rd.districts[dn];
								const sortedBranches = Object.keys(dd.branches).sort();
								const branches = sortedBranches.map(bn => dd.branches[bn]);
								return { district: dn, data: dd, branches: branches };
							});
							return { region: rn, data: rd, districts: districts };
						});
						result.push({ zone: zoneName, data: zd, regions: regions });
					});
					return result;
				},
				renderMisTable: function(tableContainer, dashboardInstance) {
					const self = this;
					const format = dashboardInstance.state.formatMode || "number";

					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						if (format === "words") {
							if (n >= 10000000) return "₹ " + (n / 10000000).toFixed(2) + " Cr";
							if (n >= 100000) return "₹ " + (n / 100000).toFixed(2) + " L";
							if (n >= 1000) return "₹ " + (n / 1000).toFixed(2) + " K";
						}
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const fmtPct = (coll, dem) => {
						const d = parseFloat(dem);
						const c = parseFloat(coll);
						if (!d || d <= 0) return "0.00%";
						return ((c / d) * 100).toFixed(2) + "%";
					};

					const zoneData = self.aggregateByZone();
					const totalFilteredDemand = zoneData.reduce((s, z) => s + z.data.monthly_demand_amount, 0);
					const totalAllDemand = (self.tableData || []).reduce((s, r) => s + (parseFloat(r.monthly_demand_amount) || 0), 0);
					const $badge = tableContainer.parent().find("#mis-records-count");
					$badge.text(fmtAmt(totalFilteredDemand) + " / " + fmtAmt(totalAllDemand) + " demand" + (self.searchTerm ? " (filtered)" : ""));
					if (totalFilteredDemand === totalAllDemand && !self.searchTerm) $badge.hide(); else $badge.show();

					if (!zoneData || zoneData.length === 0) {
						tableContainer.html('<div style="padding: 30px; text-align: center; color: #64748b; font-weight: 600; font-family: \'Inter\', sans-serif;">No data to display.</div>');
						return;
					}

					const grandTotal = { monthly_demand_amount: 0.0, monthly_collection: 0.0 };
					zoneData.forEach(z => {
						grandTotal.monthly_demand_amount += z.data.monthly_demand_amount;
						grandTotal.monthly_collection += z.data.monthly_collection;
					});

					let sr = 0;
					let rowsHtml = "";
					zoneData.forEach(z => {
						sr++;
						const zoneExpanded = self.expandedZones[z.zone];
						const zoneRow = z.data;
						const zoneChecked = self.checkedRows["zone::" + z.zone];
						
						rowsHtml += `<tr class="mis-zone-row${zoneChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-check-id="zone::${z.zone}" style="cursor: pointer; background: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
							<td style="padding: 10px 14px; text-align: center; white-space: nowrap; width: 30px; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="zone::${z.zone}" ${zoneChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; width: 40px; font-size: 14px;">${sr}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; white-space: nowrap; font-size: 14px;"><span class="mis-zone-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #64748b;">${zoneExpanded ? "▼" : "▶"}</span>${z.zone}</td>
							<td></td>
							<td></td>
							<td></td>
							<td></td>
							<td></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(zoneRow.monthly_demand_amount)}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(zoneRow.monthly_collection)}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; background: #e2e8f0;">${fmtPct(zoneRow.monthly_collection, zoneRow.monthly_demand_amount)}</td>
						</tr>`;

						z.regions.forEach(regionObj => {
							const region = regionObj.region;
							const regionRow = regionObj.data;
							const regionKey = z.zone + "::" + region;
							const regionExpanded = self.expandedRegions[regionKey];
							const regionChecked = self.checkedRows[regionKey];
							
							rowsHtml += `<tr class="mis-region-row${regionChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-check-id="${regionKey}" style="display: ${zoneExpanded ? "table-row" : "none"}; cursor: pointer; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
								<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${regionKey}" ${regionChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
								<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
								<td style="padding: 8px 14px; color: #334155; white-space: nowrap; font-size: 14px; padding-left: 24px; font-weight: 600;"><span class="mis-region-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #94a3b8;">${regionExpanded ? "▼" : "▶"}</span>${region}</td>
								<td></td>
								<td></td>
								<td></td>
								<td></td>
								<td></td>
								<td style="padding: 8px 14px; color: #334155; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(regionRow.monthly_demand_amount)}</td>
								<td style="padding: 8px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(regionRow.monthly_collection)}</td>
								<td style="padding: 8px 14px; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f1f5f9;">${fmtPct(regionRow.monthly_collection, regionRow.monthly_demand_amount)}</td>
							</tr>`;

							regionObj.districts.forEach(districtObj => {
								const district = districtObj.district;
								const districtKey = z.zone + "::" + region + "::" + district;
								const districtExpanded = self.expandedDistricts[districtKey];
								const districtChecked = self.checkedRows[districtKey];
								const showDistrict = zoneExpanded && regionExpanded;

								rowsHtml += `<tr class="mis-district-row${districtChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-check-id="${districtKey}" style="display: ${showDistrict ? "table-row" : "none"}; cursor: pointer; background: #fafaf9; border-bottom: 1px solid #e7e5e4;">
									<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${districtKey}" ${districtChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
									<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
									<td style="padding: 8px 14px; color: #44403c; white-space: nowrap; font-size: 14px; padding-left: 42px; font-weight: 600;"><span class="mis-district-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #a8a29e;">${districtExpanded ? "▼" : "▶"}</span>${district}</td>
									<td></td>
									<td></td>
									<td></td>
									<td></td>
									<td></td>
									<td style="padding: 8px 14px; color: #44403c; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(districtObj.data.monthly_demand_amount)}</td>
									<td style="padding: 8px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(districtObj.data.monthly_collection)}</td>
									<td style="padding: 8px 14px; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f5f5f4;">${fmtPct(districtObj.data.monthly_collection, districtObj.data.monthly_demand_amount)}</td>
								</tr>`;

								districtObj.branches.forEach((branch, bnIndex) => {
									const branchKey = districtKey + "::" + branch.sol_id;
									const branchExpanded = self.expandedBranches[branchKey];
									const branchChecked = self.checkedRows[branchKey];
									const showBranch = zoneExpanded && regionExpanded && districtExpanded;

									rowsHtml += `<tr class="mis-branch-row${branchChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-branch="${branch.sol_id}" data-check-id="${branchKey}" style="display: ${showBranch ? "table-row" : "none"}; cursor: pointer; background: #ffffff; border-bottom: 1px solid #e2e8f0;">
										<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${branchKey}" ${branchChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
										<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
										<td style="padding: 6px 14px; color: #475569; white-space: nowrap; font-size: 14px; padding-left: 60px; font-weight: 600;"><span class="mis-branch-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #cbd5e1;">${branchExpanded ? "▼" : "▶"}</span>${branch.sol_id} - ${branch.sol_desc}</td>
										<td></td>
										<td></td>
										<td></td>
										<td></td>
										<td></td>
										<td style="padding: 6px 14px; color: #475569; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(branch.monthly_demand_amount)}</td>
										<td style="padding: 6px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(branch.monthly_collection)}</td>
										<td style="padding: 6px 14px; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 700; background: #f8fafc;">${fmtPct(branch.monthly_collection, branch.monthly_demand_amount)}</td>
									</tr>`;

									branch.agents.forEach((auth, ai) => {
										const showAuth = zoneExpanded && regionExpanded && districtExpanded && branchExpanded;
										const authBg = ai % 2 === 0 ? "#fafafa" : "#f5f5f5";
										const authKey = branchKey + "::" + auth.rm_id + "::" + auth.auth_id;
										const authChecked = self.checkedRows[authKey];
										
										rowsHtml += `<tr class="mis-auth-row${authChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-branch="${branch.sol_id}" data-check-id="${authKey}" style="display: ${showAuth ? "table-row" : "none"}; background: ${authBg}; border-bottom: 1px solid #f1f5f9;">
											<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${authKey}" ${authChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
											<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
											<td style="padding: 6px 14px; color: #94a3b8; white-space: nowrap; font-size: 14px; padding-left: 78px; font-weight: 500;">└─</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.rm_id || "-"}</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.rm_name || "-"}</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.auth_id || "-"}</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.auth_name || "-"}</td>
											<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${auth.designation || "-"}</td>
											<td style="padding: 6px 14px; color: #64748b; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtAmt(auth.monthly_demand_amount)}</td>
											<td style="padding: 6px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtAmt(auth.monthly_collection)}</td>
											<td style="padding: 6px 14px; color: #8b5cf6; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtPct(auth.monthly_collection, auth.monthly_demand_amount)}</td>
										</tr>`;

									});
								});
							});
						});
					});

					const tableHtml = `
						<style>
							#mis-agent-demand-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
							#mis-agent-demand-table thead { position: sticky; top: 0; z-index: 2; }
							#mis-agent-demand-table tfoot { position: sticky; bottom: 0; z-index: 2; }
							#mis-agent-demand-table tfoot tr { box-shadow: 0 -2px 6px rgba(0,0,0,0.1); }
							#mis-agent-demand-table tbody tr { transition: background-color 0.2s ease; border-bottom: 1px solid #e2e8f0; }
							#mis-agent-demand-table tbody tr:hover { background: #dcfce7 !important; }
							#mis-agent-demand-table tbody tr.mis-row-checked { background: #bbf7d0 !important; }
							#mis-agent-demand-table tbody tr.mis-zone-row.mis-row-checked,
							#mis-agent-demand-table tbody tr.mis-region-row.mis-row-checked,
							#mis-agent-demand-table tbody tr.mis-district-row.mis-row-checked,
							#mis-agent-demand-table tbody tr.mis-branch-row.mis-row-checked,
							#mis-agent-demand-table tbody tr.mis-auth-row.mis-row-checked { background: #86efac !important; }
							#mis-agent-scroll-area { max-height: 550px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
						</style>
						<div id="mis-agent-scroll-area">
							<table id="mis-agent-demand-table">
								<thead><tr style="background: linear-gradient(180deg, #3d7579 0%, #346569 100%); color: #ffffff;">
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 30px;"><input type="checkbox" class="mis-check-all" style="cursor: pointer; width: 14px; height: 14px;"></th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 40px;">Sr</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap;">Z / R / D / SOL Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 120px;">Agent Code</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 180px;">Agent Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 120px;">Auth ID</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 180px;">Auth Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 150px;">Designation</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; white-space: nowrap; width: 150px;">Monthly Demand</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; white-space: nowrap; width: 150px;">Sum of Collection</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 120px;">Collection %</th>
								</tr></thead>
								<tbody>${rowsHtml}</tbody>
								<tfoot><tr style="background: #1e293b; color: #ffffff; font-weight: 700;">
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: left; white-space: nowrap; font-size: 14px;">TOTAL</td>
									<td></td>
									<td></td>
									<td></td>
									<td></td>
									<td></td>
									<td style="padding: 10px 12px; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(grandTotal.monthly_demand_amount)}</td>
									<td style="padding: 10px 12px; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(grandTotal.monthly_collection)}</td>
									<td style="padding: 10px 12px; text-align: center; white-space: nowrap; font-size: 14px;">${fmtPct(grandTotal.monthly_collection, grandTotal.monthly_demand_amount)}</td>
								</tr></tfoot>
							</table>
						</div>`;
					tableContainer.html(tableHtml);

					// Attach folding handlers
					tableContainer.off("click", ".mis-zone-row").on("click", ".mis-zone-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						self.expandedZones[zone] = !self.expandedZones[zone];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-region-row").on("click", ".mis-region-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const key = zone + "::" + region;
						self.expandedRegions[key] = !self.expandedRegions[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-district-row").on("click", ".mis-district-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const key = zone + "::" + region + "::" + district;
						self.expandedDistricts[key] = !self.expandedDistricts[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-branch-row").on("click", ".mis-branch-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const branch = $(this).data("branch");
						const key = zone + "::" + region + "::" + district + "::" + branch;
						self.expandedBranches[key] = !self.expandedBranches[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					// Attach checkbox handlers
					tableContainer.off("change", ".mis-row-check").on("change", ".mis-row-check", function () {
						const checkId = $(this).data("check-id");
						const checked = $(this).prop("checked");
						self.checkedRows[checkId] = checked;
						const tr = $(this).closest("tr");
						if (checked) tr.addClass("mis-row-checked"); else tr.removeClass("mis-row-checked");
					});

					tableContainer.off("change", ".mis-check-all").on("change", ".mis-check-all", function () {
						const checked = $(this).prop("checked");
						tableContainer.find(".mis-row-check").each(function () {
							$(this).prop("checked", checked).trigger("change");
						});
					});
				}
			},
			{	id: "maturity_tracker",
				name: "Maturity Tracker",
				tableData: [],
				expandedZones: {},
				expandedRegions: {},
				expandedDistricts: {},
				expandedBranches: {},
				checkedRows: {},
				searchTerm: "",
				allExpanded: false,
				selectedMisZones: [],
				render: function (container, dashboardInstance, seq) {
					const self = this;
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<input type="text" id="mis-search" placeholder="Search branch, SOL ID, district or customer..." style="padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 200px; background: white; color: #1b263b; font-size: 13px; outline: none;">
							<button type="button" id="mis-expand-toggle" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">▼ Expand All</button>
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: flex; align-items: center; gap: 6px; margin-left: auto;">
								<span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
								<div class="btn-group mis-format-toggle" role="group">
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
									<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
								</div>
							</div>
							<div style="font-size: 13px; font-weight: 700; color: #417d81; background: rgba(65,125,129,0.08); padding: 6px 12px; border-radius: 6px;" id="mis-records-count"></div>
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							${dashboardInstance.buildMisSkeletonTable("Loading Maturity Tracker...")}
						</div>
						<div id="mis-zone-filter-row" style="display: none; margin-bottom: 10px;"></div>
						<div id="mis-kpi-container" ${self.tableData && self.tableData.length ? "" : 'style="display: none;"'}></div>
						<div id="mis-table-container" ${self.tableData ? "" : 'style="display: none;"'}></div>
					`);

					if (self.tableData && self.tableData.length > 0) {
						self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
						container.find("#mis-records-count").text(`${self.tableData.length} records`);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
						self.renderZoneFilterTags(container, dashboardInstance);
						container.find("#mis-controls, #mis-table-container, #mis-kpi-container").show();
						container.find("#mis-loading").hide();
						self.attachReportEventHandlers(container, dashboardInstance);
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_maturity_tracker_data",
						args: { selected_date: dashboardInstance.state.selectedDate },
						callback: function (r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							container.find("#mis-loading").hide();
							if (r.message && r.message.length) {
								self.tableData = r.message;
								self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
								container.find("#mis-records-count").text(`${r.message.length} records`);
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
								self.renderZoneFilterTags(container, dashboardInstance);
							}
							container.find("#mis-controls, #mis-table-container, #mis-kpi-container, #mis-zone-filter-row").show();
						}
					});
					self.attachReportEventHandlers(container, dashboardInstance);
				},
				attachReportEventHandlers: function (container, dashboardInstance) {
					const self = this;
					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").each(function () {
							const btn = $(this);
							const isActive = btn.data("format") === format;
							btn.css("background", isActive ? "#417d81" : "#e2e8f0");
							btn.css("color", isActive ? "white" : "#475569");
						});
						if (self.tableData && self.tableData.length > 0) {
							self.switchFormat(format, container, dashboardInstance);
						}
					});
					let searchTimeout;
					container.off("input", "#mis-search").on("input", "#mis-search", function () {
						clearTimeout(searchTimeout);
						searchTimeout = setTimeout(() => {
							self.searchTerm = $(this).val().toLowerCase().trim();
							if (self.tableData) {
								self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
							}
						}, 300);
					});
					container.off("click", "#mis-expand-toggle").on("click", "#mis-expand-toggle", function () {
						self.allExpanded = !self.allExpanded;
						const expand = self.allExpanded;
						if (!self.tableData) return;
						const zoneData = self.aggregateByZone();
						zoneData.forEach(z => {
							self.expandedZones[z.zone] = expand;
							z.regions.forEach(r => {
								self.expandedRegions[z.zone + "::" + r.region] = expand;
								r.districts.forEach(d => {
									self.expandedDistricts[z.zone + "::" + r.region + "::" + d.district] = expand;
									d.branches.forEach(b => {
										self.expandedBranches[z.zone + "::" + r.region + "::" + d.district + "::" + b.sol_id] = expand;
									});
								});
							});
						});
						$(this).text(expand ? "▲ Collapse All" : "▼ Expand All");
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.refetchData(container, dashboardInstance);
					});
				},
				renderKPI: function (container, dashboardInstance) {
					const self = this;
					const data = self.tableData || [];
					const totalAccounts = data.reduce((s, r) => s + (parseInt(r.account_count || 0, 10)), 0);
					const totalPaid = data.reduce((s, r) => s + (parseFloat(r.maturity_paid || 0.0)), 0.0);
					const totalDeposit = data.reduce((s, r) => s + (parseFloat(r.total_deposit_amount || 0.0)), 0.0);
					const totalRenewal = data.reduce((s, r) => s + (parseFloat(r.renewal_amount || 0.0)), 0.0);
					const depositDoneCount = data.filter(r => (r.deposit_done_flag || "").toLowerCase() === "yes").length;

					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						const format = dashboardInstance.state.formatMode || "number";
						if (format === "words") {
							if (n >= 10000000) return "₹ " + (n / 10000000).toFixed(2) + " Cr";
							if (n >= 100000) return "₹ " + (n / 100000).toFixed(2) + " L";
							if (n >= 1000) return "₹ " + (n / 1000).toFixed(2) + " K";
						}
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const fmtCount = (val) => {
						return new Intl.NumberFormat("en-IN").format(val);
					};

					const kpiCards = [
						{ label: "Maturity Paid", value: fmtAmt(totalPaid), color: "#ef4444", bg: "#fef2f2", icon: "💰" },
						{ label: "Total Deposit Amount", value: fmtAmt(totalDeposit), color: "#10b981", bg: "#ecfdf5", icon: "📊" },
						{ label: "Renewal Amount", value: fmtAmt(totalRenewal), color: "#3b82f6", bg: "#eff6ff", icon: "📈" },
						{ label: "Total Accounts", value: fmtCount(totalAccounts), color: "#8b5cf6", bg: "#f5f3ff", icon: "🔢" },
						{ label: "Deposit Done Count", value: fmtCount(depositDoneCount), color: "#06b6d4", bg: "#ecfeff", icon: "✅" }
					];

					container.html(`
						<style>
							#maturity-tracker-kpi-container { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
							#maturity-tracker-kpi-container .kpi-card { flex: 1 1 180px; min-width: 150px; border-radius: 10px; padding: 16px 18px; box-shadow: 0 2px 4px rgba(0,0,0,0.04); box-sizing: border-box; min-height: 100px; }
							#maturity-tracker-kpi-container .kpi-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
							#maturity-tracker-kpi-container .kpi-icon { font-size: 20px; flex-shrink: 0; line-height: 1; }
							#maturity-tracker-kpi-container .kpi-label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-family: 'Inter', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
							#maturity-tracker-kpi-container .kpi-value { font-size: clamp(18px, 2.2vw, 24px); font-weight: 800; font-family: 'Inter', sans-serif; line-height: 1.2; word-break: break-word; }
							@media (max-width: 768px) { #maturity-tracker-kpi-container .kpi-card { flex: 1 1 140px; min-width: 120px; padding: 12px 14px; min-height: 80px; } #maturity-tracker-kpi-container .kpi-value { font-size: 16px; } }
							@media (max-width: 480px) { #maturity-tracker-kpi-container .kpi-card { flex: 1 1 100%; min-width: unset; } }
						</style>
						<div id="maturity-tracker-kpi-container">
							${kpiCards.map(card => `<div class="kpi-card" style="background: ${card.bg}; border-left: 4px solid ${card.color};"><div class="kpi-card-header"><span class="kpi-icon">${card.icon}</span><span class="kpi-label">${card.label}</span></div><div class="kpi-value" style="color: ${card.color};">${card.value}</div></div>`).join('')}
						</div>
					`);
				},
				refetchData: function (container, dashboardInstance) {
					const self = this;
					self.tableData = [];
					self.expandedZones = {};
					self.expandedRegions = {};
					self.expandedDistricts = {};
					self.expandedBranches = {};
					self.checkedRows = {};
					self.searchTerm = "";
					self.allExpanded = false;
					self.selectedMisZones = [];
					dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
					self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
				},
				switchFormat: function (format, container, dashboardInstance) {
					const self = this;
					if (self.tableData && self.tableData.length > 0) {
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					}
					self.renderKPI(container.find("#mis-kpi-container"), dashboardInstance);
				},
				renderZoneFilterTags: function (container, dashboardInstance) {
					const self = this;
					if (!self.tableData || self.tableData.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					let zones = [...new Set(self.tableData.map(r => r.zone).filter(Boolean))].sort();
					if (zones.length === 0) {
						container.find("#mis-zone-filter-row").hide();
						return;
					}
					const allSelected = self.selectedMisZones.length === 0;
					let html = '<span style="font-weight: 600; color: #475569; font-size: 13px; white-space: nowrap;">Zone:</span>';
					html += `<button class="mis-zone-filter-tag ${allSelected ? "active" : ""}" data-zone="all" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${allSelected ? "#417d81" : "#fff"}; color: ${allSelected ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">All</button>`;
					zones.forEach(zone => {
						const active = self.selectedMisZones.includes(zone);
						html += `<button class="mis-zone-filter-tag ${active ? "active" : ""}" data-zone="${zone}" style="padding: 4px 12px; font-size: 12px; font-weight: 600; border: 1px solid #cbd5e1; border-radius: 9999px; background: ${active ? "#417d81" : "#fff"}; color: ${active ? "#fff" : "#475569"}; cursor: pointer; transition: all 0.2s;">${zone}</button>`;
					});
					const $row = container.find("#mis-zone-filter-row");
					$row.html(html).css("display", "flex").css({ "align-items": "center", "gap": "8px", "flex-wrap": "wrap", "margin-bottom": "10px" });
					container.off("click", ".mis-zone-filter-tag").on("click", ".mis-zone-filter-tag", function () {
						const zone = $(this).data("zone");
						if (zone === "all") {
							self.selectedMisZones = [];
						} else {
							const idx = self.selectedMisZones.indexOf(zone);
							if (idx > -1) { self.selectedMisZones.splice(idx, 1); } else { self.selectedMisZones.push(zone); }
						}
						self.renderZoneFilterTags(container, dashboardInstance);
						self.renderMisTable(container.find("#mis-table-container"), dashboardInstance);
					});
				},
				aggregateByZone: function () {
					const self = this;
					let data = self.tableData || [];
					const term = (self.searchTerm || "").trim().toLowerCase();
					if (term) {
						data = data.filter(row => {
							const zone = (row.zone || "").toLowerCase();
							const region = (row.region || "").toLowerCase();
							const district = (row.district || "").toLowerCase();
							const sol = (row.sol_desc || row.sol_id || "").toLowerCase();
							const solId = (row.sol_id || "").toLowerCase();
							const cif = (row.cif_id || "").toLowerCase();
							const name = (row.acct_name || "").toLowerCase();
							return zone.includes(term) || region.includes(term) || district.includes(term) || sol.includes(term) || solId.includes(term) || cif.includes(term) || name.includes(term);
						});
					}
					if (self.selectedMisZones && self.selectedMisZones.length > 0) {
						data = data.filter(row => self.selectedMisZones.includes(row.zone));
					}
					const zoneMap = {};
					data.forEach(row => {
						const zone = row.zone || "Unknown";
						const region = row.region || "Unknown";
						const district = row.district || "Unknown";
						const solId = row.sol_id || "Unknown";
						const solDesc = row.sol_desc || row.sol_id || "Unknown";

						if (!zoneMap[zone]) {
							zoneMap[zone] = { zone, regions: {}, account_count: 0, maturity_paid: 0.0, total_deposit_amount: 0.0, renewal_amount: 0.0, branches_count: new Set() };
						}
						if (!zoneMap[zone].regions[region]) {
							zoneMap[zone].regions[region] = { region, districts: {}, account_count: 0, maturity_paid: 0.0, total_deposit_amount: 0.0, renewal_amount: 0.0, branches_count: new Set() };
						}
						if (!zoneMap[zone].regions[region].districts[district]) {
							zoneMap[zone].regions[region].districts[district] = { district, branches: {}, account_count: 0, maturity_paid: 0.0, total_deposit_amount: 0.0, renewal_amount: 0.0 };
						}
						if (!zoneMap[zone].regions[region].districts[district].branches[solId]) {
							zoneMap[zone].regions[region].districts[district].branches[solId] = {
								sol_id: solId,
								sol_desc: solDesc,
								records: [],
								account_count: 0,
								maturity_paid: 0.0,
								total_deposit_amount: 0.0,
								renewal_amount: 0.0
							};
						}

						const branchObj = zoneMap[zone].regions[region].districts[district].branches[solId];
						branchObj.records.push(row);

						const acCount = parseInt(row.account_count || 0, 10);
						const matPaid = parseFloat(row.maturity_paid || 0);
						const totDep = parseFloat(row.total_deposit_amount || 0);
						const renAmt = parseFloat(row.renewal_amount || 0);

						branchObj.account_count += acCount;
						branchObj.maturity_paid += matPaid;
						branchObj.total_deposit_amount += totDep;
						branchObj.renewal_amount += renAmt;

						zoneMap[zone].regions[region].districts[district].account_count += acCount;
						zoneMap[zone].regions[region].districts[district].maturity_paid += matPaid;
						zoneMap[zone].regions[region].districts[district].total_deposit_amount += totDep;
						zoneMap[zone].regions[region].districts[district].renewal_amount += renAmt;

						zoneMap[zone].regions[region].account_count += acCount;
						zoneMap[zone].regions[region].maturity_paid += matPaid;
						zoneMap[zone].regions[region].total_deposit_amount += totDep;
						zoneMap[zone].regions[region].renewal_amount += renAmt;
						zoneMap[zone].regions[region].branches_count.add(solId);

						zoneMap[zone].account_count += acCount;
						zoneMap[zone].maturity_paid += matPaid;
						zoneMap[zone].total_deposit_amount += totDep;
						zoneMap[zone].renewal_amount += renAmt;
						zoneMap[zone].branches_count.add(solId);
					});

					const sortedZones = Object.keys(zoneMap).sort();
					const result = [];
					sortedZones.forEach(zoneName => {
						const zd = zoneMap[zoneName];
						const sortedRegions = Object.keys(zd.regions).sort();
						const regions = sortedRegions.map(rn => {
							const rd = zd.regions[rn];
							const sortedDistricts = Object.keys(rd.districts).sort();
							const districts = sortedDistricts.map(dn => {
								const dd = rd.districts[dn];
								const sortedBranches = Object.keys(dd.branches).sort();
								const branches = sortedBranches.map(bn => dd.branches[bn]);
								return { district: dn, data: dd, branches: branches };
							});
							return { region: rn, data: rd, districts: districts };
						});
						result.push({ zone: zoneName, data: zd, regions: regions });
					});
					return result;
				},
				checkCxoPermission: function (dashboardInstance, callback) {
					if (dashboardInstance.canViewCommission !== undefined) {
						callback(dashboardInstance.canViewCommission);
						return;
					}

					if (frappe.session.user === "Administrator") {
						dashboardInstance.canViewCommission = true;
						callback(true);
						return;
					}

					frappe.db.get_value("Employee", { user_id: frappe.session.user }, "cxo_level")
						.then(r => {
							const cxo = r && r.message ? (r.message.cxo_level !== undefined ? r.message.cxo_level : r.message) : 0;
							dashboardInstance.canViewCommission = (cint(cxo) === 1);
							callback(dashboardInstance.canViewCommission);
						})
						.catch(err => {
							console.error("Error checking employee cxo_level:", err);
							dashboardInstance.canViewCommission = false;
							callback(false);
						});
				},
				renderMisTable: function (tableContainer, dashboardInstance) {
					const self = this;
					if (dashboardInstance.canViewCommission === undefined) {
						self.checkCxoPermission(dashboardInstance, () => {
							self.renderMisTable(tableContainer, dashboardInstance);
						});
						return;
					}
					const canViewCif = !!dashboardInstance.canViewCommission;
					const format = dashboardInstance.state.formatMode || "number";

					const fmtAmt = (val) => {
						if (val === null || val === undefined) return "-";
						const n = parseFloat(val);
						if (isNaN(n)) return val;
						if (format === "words") {
							if (n >= 10000000) return "₹ " + (n / 10000000).toFixed(2) + " Cr";
							if (n >= 100000) return "₹ " + (n / 100000).toFixed(2) + " L";
							if (n >= 1000) return "₹ " + (n / 1000).toFixed(2) + " K";
						}
						return "₹ " + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
					};

					const fmtCount = (val) => {
						if (val === null || val === undefined) return "0";
						return new Intl.NumberFormat("en-IN").format(val);
					};

					const zoneData = self.aggregateByZone();
					const totalFilteredPaid = zoneData.reduce((s, z) => s + z.data.maturity_paid, 0);
					const totalAllPaid = (self.tableData || []).reduce((s, r) => s + (parseFloat(r.maturity_paid) || 0), 0);
					const $badge = tableContainer.parent().find("#mis-records-count");
					$badge.text(fmtAmt(totalFilteredPaid) + " / " + fmtAmt(totalAllPaid) + " paid" + (self.searchTerm ? " (filtered)" : ""));
					if (totalFilteredPaid === totalAllPaid && !self.searchTerm) $badge.hide(); else $badge.show();

					if (!zoneData || zoneData.length === 0) {
						tableContainer.html('<div style="padding: 30px; text-align: center; color: #64748b; font-weight: 600; font-family: \'Inter\', sans-serif;">No data to display.</div>');
						return;
					}

					const grandTotal = { account_count: 0, maturity_paid: 0.0, total_deposit_amount: 0.0, renewal_amount: 0.0 };
					zoneData.forEach(z => {
						grandTotal.account_count += z.data.account_count;
						grandTotal.maturity_paid += z.data.maturity_paid;
						grandTotal.total_deposit_amount += z.data.total_deposit_amount;
						grandTotal.renewal_amount += z.data.renewal_amount;
					});

					let sr = 0;
					let rowsHtml = "";
					zoneData.forEach(z => {
						sr++;
						const zoneExpanded = self.expandedZones[z.zone];
						const zoneRow = z.data;
						const zoneChecked = self.checkedRows["zone::" + z.zone];
						
						rowsHtml += `<tr class="mis-zone-row${zoneChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-check-id="zone::${z.zone}" style="cursor: pointer; background: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
							<td style="padding: 10px 14px; text-align: center; white-space: nowrap; width: 30px; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="zone::${z.zone}" ${zoneChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; width: 40px; font-size: 14px;">${sr}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; white-space: nowrap; font-size: 14px;"><span class="mis-zone-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #64748b;">${zoneExpanded ? "▼" : "▶"}</span>${z.zone}</td>
							<td></td>
							<td></td>
							<td></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #0f172a; text-align: center; white-space: nowrap; font-size: 14px;">${fmtCount(zoneRow.account_count)}</td>
							<td style="padding: 10px 14px; font-weight: 700; color: #ef4444; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(zoneRow.maturity_paid)}</td>
							<td></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(zoneRow.total_deposit_amount)}</td>
							<td></td>
							<td style="padding: 10px 14px; font-weight: 700; color: #3b82f6; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(zoneRow.renewal_amount)}</td>
						</tr>`;

						z.regions.forEach(regionObj => {
							const region = regionObj.region;
							const regionRow = regionObj.data;
							const regionKey = z.zone + "::" + region;
							const regionExpanded = self.expandedRegions[regionKey];
							const regionChecked = self.checkedRows[regionKey];
							
							rowsHtml += `<tr class="mis-region-row${regionChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-check-id="${regionKey}" style="display: ${zoneExpanded ? "table-row" : "none"}; cursor: pointer; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
								<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${regionKey}" ${regionChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
								<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
								<td style="padding: 8px 14px; color: #334155; white-space: nowrap; font-size: 14px; padding-left: 24px; font-weight: 600;"><span class="mis-region-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #94a3b8;">${regionExpanded ? "▼" : "▶"}</span>${region}</td>
								<td></td>
								<td></td>
								<td></td>
								<td style="padding: 8px 14px; color: #334155; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtCount(regionRow.account_count)}</td>
								<td style="padding: 8px 14px; color: #ef4444; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(regionRow.maturity_paid)}</td>
								<td></td>
								<td style="padding: 8px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(regionRow.total_deposit_amount)}</td>
								<td></td>
								<td style="padding: 8px 14px; color: #3b82f6; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(regionRow.renewal_amount)}</td>
							</tr>`;

							regionObj.districts.forEach(districtObj => {
								const district = districtObj.district;
								const districtKey = z.zone + "::" + region + "::" + district;
								const districtExpanded = self.expandedDistricts[districtKey];
								const districtChecked = self.checkedRows[districtKey];
								const showDistrict = zoneExpanded && regionExpanded;

								rowsHtml += `<tr class="mis-district-row${districtChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-check-id="${districtKey}" style="display: ${showDistrict ? "table-row" : "none"}; cursor: pointer; background: #fafaf9; border-bottom: 1px solid #e7e5e4;">
									<td style="padding: 8px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${districtKey}" ${districtChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
									<td style="padding: 8px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px;"></td>
									<td style="padding: 8px 14px; color: #44403c; white-space: nowrap; font-size: 14px; padding-left: 42px; font-weight: 600;"><span class="mis-district-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #a8a29e;">${districtExpanded ? "▼" : "▶"}</span>${district}</td>
									<td></td>
									<td></td>
									<td></td>
									<td style="padding: 8px 14px; color: #44403c; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtCount(districtObj.data.account_count)}</td>
									<td style="padding: 8px 14px; color: #ef4444; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(districtObj.data.maturity_paid)}</td>
									<td></td>
									<td style="padding: 8px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(districtObj.data.total_deposit_amount)}</td>
									<td></td>
									<td style="padding: 8px 14px; color: #3b82f6; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(districtObj.data.renewal_amount)}</td>
								</tr>`;

								districtObj.branches.forEach((branch, bnIndex) => {
									const branchKey = districtKey + "::" + branch.sol_id;
									const branchExpanded = self.expandedBranches[branchKey];
									const branchChecked = self.checkedRows[branchKey];
									const showBranch = zoneExpanded && regionExpanded && districtExpanded;

									rowsHtml += `<tr class="mis-branch-row${branchChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-branch="${branch.sol_id}" data-check-id="${branchKey}" style="display: ${showBranch ? "table-row" : "none"}; cursor: ${canViewCif ? "pointer" : "default"}; background: #ffffff; border-bottom: 1px solid #e2e8f0;">
										<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${branchKey}" ${branchChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
										<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
										<td style="padding: 6px 14px; color: #475569; white-space: nowrap; font-size: 14px; padding-left: 60px; font-weight: 600;">${canViewCif ? `<span class="mis-branch-toggle" style="cursor: pointer; margin-right: 6px; font-size: 12px; color: #cbd5e1;">${branchExpanded ? "▼" : "▶"}</span>` : ""}${branch.sol_id} - ${branch.sol_desc}</td>
										<td></td>
										<td></td>
										<td></td>
										<td style="padding: 6px 14px; color: #475569; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtCount(branch.account_count)}</td>
										<td style="padding: 6px 14px; color: #ef4444; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(branch.maturity_paid)}</td>
										<td></td>
										<td style="padding: 6px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(branch.total_deposit_amount)}</td>
										<td></td>
										<td style="padding: 6px 14px; color: #3b82f6; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 600;">${fmtAmt(branch.renewal_amount)}</td>
									</tr>`;

									if (canViewCif) {
										branch.records.forEach((rec, ai) => {
											const showRecord = zoneExpanded && regionExpanded && districtExpanded && branchExpanded;
											const recBg = ai % 2 === 0 ? "#fafafa" : "#f5f5f5";
											const recKey = branchKey + "::" + (rec.cif_id || ai);
											const recChecked = self.checkedRows[recKey];
											
											rowsHtml += `<tr class="mis-rec-row${recChecked ? " mis-row-checked" : ""}" data-zone="${z.zone}" data-region="${region}" data-district="${district}" data-branch="${branch.sol_id}" data-check-id="${recKey}" style="display: ${showRecord ? "table-row" : "none"}; background: ${recBg}; border-bottom: 1px solid #f1f5f9;">
												<td style="padding: 6px 14px; text-align: center; white-space: nowrap; vertical-align: middle;"><input type="checkbox" class="mis-row-check" data-check-id="${recKey}" ${recChecked ? "checked" : ""} style="cursor: pointer; width: 14px; height: 14px;"></td>
												<td style="padding: 6px 14px; color: #94a3b8; text-align: center; white-space: nowrap; font-size: 14px;"></td>
												<td style="padding: 6px 14px; color: #94a3b8; white-space: nowrap; font-size: 14px; padding-left: 78px; font-weight: 500;">└─</td>
												<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${rec.cif_id || "-"}</td>
												<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${rec.acct_name || "-"}</td>
												<td style="padding: 6px 14px; color: #64748b; white-space: nowrap; font-size: 14px; font-weight: 500;">${rec.account_numbers || "-"}</td>
												<td style="padding: 6px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtCount(rec.account_count)}</td>
												<td style="padding: 6px 14px; color: #ef4444; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtAmt(rec.maturity_paid)}</td>
												<td style="padding: 6px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">${rec.last_debit_transaction_date || "-"}</td>
												<td style="padding: 6px 14px; color: #10b981; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtAmt(rec.total_deposit_amount)}</td>
												<td style="padding: 6px 14px; color: #64748b; text-align: center; white-space: nowrap; font-size: 14px; font-weight: 500;">${rec.deposit_done_flag || "No"}</td>
												<td style="padding: 6px 14px; color: #3b82f6; text-align: right; white-space: nowrap; font-size: 14px; font-weight: 500;">${fmtAmt(rec.renewal_amount)}</td>
											</tr>`;
										});
									}
								});
							});
						});
					});

					const tableHtml = `
						<style>
							#mis-maturity-tracker-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
							#mis-maturity-tracker-table thead { position: sticky; top: 0; z-index: 2; }
							#mis-maturity-tracker-table tfoot { position: sticky; bottom: 0; z-index: 2; }
							#mis-maturity-tracker-table tfoot tr { box-shadow: 0 -2px 6px rgba(0,0,0,0.1); }
							#mis-maturity-tracker-table tbody tr { transition: background-color 0.2s ease; border-bottom: 1px solid #e2e8f0; }
							#mis-maturity-tracker-table tbody tr:hover { background: #dcfce7 !important; }
							#mis-maturity-tracker-table tbody tr.mis-row-checked { background: #bbf7d0 !important; }
							#mis-maturity-tracker-table tbody tr.mis-zone-row.mis-row-checked,
							#mis-maturity-tracker-table tbody tr.mis-region-row.mis-row-checked,
							#mis-maturity-tracker-table tbody tr.mis-district-row.mis-row-checked,
							#mis-maturity-tracker-table tbody tr.mis-branch-row.mis-row-checked,
							#mis-maturity-tracker-table tbody tr.mis-rec-row.mis-row-checked { background: #86efac !important; }
							#mis-scroll-area { max-height: 550px; overflow: auto; border: 1px solid #e2e8f0; border-radius: 6px; }
						</style>
						<div id="mis-scroll-area">
							<table id="mis-maturity-tracker-table">
								<thead><tr style="background: linear-gradient(180deg, #3d7579 0%, #346569 100%); color: #ffffff;">
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 30px;"><input type="checkbox" class="mis-check-all" style="cursor: pointer; width: 14px; height: 14px;"></th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 40px;">Sr</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap;">Z / R / D / SOL Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 100px;">CIF ID</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 160px;">Customer Name</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; white-space: nowrap; width: 160px;">Account Numbers</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 100px;">Account Count</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; white-space: nowrap; width: 140px;">Maturity Paid</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 120px;">Last Debit Date</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; white-space: nowrap; width: 140px;">Total Deposit</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; white-space: nowrap; width: 100px;">Deposit Done</th>
									<th style="padding: 10px 12px; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: right; white-space: nowrap; width: 140px;">Renewal Amount</th>
								</tr></thead>
								<tbody>${rowsHtml}</tbody>
								<tfoot><tr style="background: #1e293b; color: #ffffff; font-weight: 700;">
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: center;"></td>
									<td style="padding: 10px 12px; text-align: left; white-space: nowrap; font-size: 14px;">TOTAL</td>
									<td></td>
									<td></td>
									<td></td>
									<td style="padding: 10px 12px; text-align: center; white-space: nowrap; font-size: 14px;">${fmtCount(grandTotal.account_count)}</td>
									<td style="padding: 10px 12px; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(grandTotal.maturity_paid)}</td>
									<td></td>
									<td style="padding: 10px 12px; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(grandTotal.total_deposit_amount)}</td>
									<td></td>
									<td style="padding: 10px 12px; text-align: right; white-space: nowrap; font-size: 14px;">${fmtAmt(grandTotal.renewal_amount)}</td>
								</tr></tfoot>
							</table>
						</div>`;
					tableContainer.html(tableHtml);

					// Attach folding handlers
					tableContainer.off("click", ".mis-zone-row").on("click", ".mis-zone-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						self.expandedZones[zone] = !self.expandedZones[zone];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-region-row").on("click", ".mis-region-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const key = zone + "::" + region;
						self.expandedRegions[key] = !self.expandedRegions[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-district-row").on("click", ".mis-district-row", function (e) {
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const key = zone + "::" + region + "::" + district;
						self.expandedDistricts[key] = !self.expandedDistricts[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".mis-branch-row").on("click", ".mis-branch-row", function (e) {
						if (!canViewCif) return;
						if ($(e.target).closest("input[type=checkbox]").length) return;
						const zone = $(this).data("zone");
						const region = $(this).data("region");
						const district = $(this).data("district");
						const branch = $(this).data("branch");
						const key = zone + "::" + region + "::" + district + "::" + branch;
						self.expandedBranches[key] = !self.expandedBranches[key];
						self.renderMisTable(tableContainer, dashboardInstance);
					});

					// Attach checkbox handlers
					tableContainer.off("change", ".mis-row-check").on("change", ".mis-row-check", function () {
						const checkId = $(this).data("check-id");
						const checked = $(this).prop("checked");
						self.checkedRows[checkId] = checked;
						const tr = $(this).closest("tr");
						if (checked) tr.addClass("mis-row-checked"); else tr.removeClass("mis-row-checked");
					});

					tableContainer.off("change", ".mis-check-all").on("change", ".mis-check-all", function () {
						const checked = $(this).prop("checked");
						tableContainer.find(".mis-row-check").each(function () {
							$(this).prop("checked", checked).trigger("change");
						});
					});
				}
			},
			{
				id: "rm_wise",
				name: "Agent Wise Commission",
				tableData: [],
				render: function (container, dashboardInstance, seq) {
					const self = this;
					const t1_date = frappe.datetime.add_days(frappe.datetime.get_today(), -1);
					container.html(`
						<div style="display: flex; gap: 8px; align-items: center; margin-bottom: 10px;" id="mis-controls">
							<button type="button" id="mis-refetch" style="background: #e2e8f0; color: #475569; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px; cursor: pointer; white-space: nowrap;">⟳ Refetch</button>
							<div style="display: inline-flex; border-radius: 4px; overflow: hidden; border: 1px solid #cbd5e1;">
								<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'number' ? 'active' : ''}" data-format="number" style="background: ${dashboardInstance.state.formatMode === 'number' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'number' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 4px 0 0 4px; cursor: pointer;">Numbers</button>
								<button type="button" class="btn btn-sm mis-format-btn ${dashboardInstance.state.formatMode === 'words' ? 'active' : ''}" data-format="words" style="background: ${dashboardInstance.state.formatMode === 'words' ? '#417d81' : '#e2e8f0'}; color: ${dashboardInstance.state.formatMode === 'words' ? 'white' : '#475569'}; border: none; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 0 4px 4px 0; cursor: pointer;">Words</button>
							</div>
							<input type="text" id="rm-top-search" placeholder="Search Agent Code or Name..." style="padding: 4px 8px; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 4px; width: 220px; outline: none; margin-left: auto;">
						</div>
						<div id="mis-loading" style="width: 100%; margin-top: 10px; font-family: 'Inter', sans-serif; ${self.tableData && self.tableData.length > 0 ? 'display: none;' : ''}">
							${dashboardInstance.buildMisSkeletonTable("Fetching Agent Wise Commission data...")}
						</div>
						<div id="mis-table-container" ${self.tableData && self.tableData.length > 0 ? "" : 'style="display: none;"'}></div>
					`);

					container.off("click", "#mis-refetch").on("click", "#mis-refetch", function () {
						self.tableData = [];
						dashboardInstance._misRenderSeq = (dashboardInstance._misRenderSeq || 0) + 1;
						self.render(container, dashboardInstance, dashboardInstance._misRenderSeq);
					});

					container.off("click", ".mis-format-btn").on("click", ".mis-format-btn", function () {
						const format = $(this).data("format");
						dashboardInstance.state.formatMode = format;
						container.find(".mis-format-btn").removeClass("active").css({ background: "#e2e8f0", color: "#475569" });
						$(this).addClass("active").css({ background: "#417d81", color: "white" });
						self.renderRmWiseTable(container.find("#mis-table-container"), dashboardInstance);
					});

					let rmSearchTimeout = null;
					container.off("input", "#rm-top-search").on("input", "#rm-top-search", function () {
						const $input = $(this);
						clearTimeout(rmSearchTimeout);
						rmSearchTimeout = setTimeout(() => {
							const query = $input.val().toLowerCase().trim();
							self.filterQuery = query;
							self.renderRmWiseTable(container.find("#mis-table-container"), dashboardInstance);
						}, 300);
					});

					if (self.tableData && self.tableData.length > 0) {
						self.renderRmWiseTable(container.find("#mis-table-container"), dashboardInstance);
						container.find("#mis-controls, #mis-table-container").show();
						container.find("#mis-loading").hide();
						return;
					}

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_rm_wise_ss_vs_data",
						args: {
							selected_date: t1_date
						},
						callback: function (r) {
							if (dashboardInstance._misRenderSeq !== seq) return;
							const msg = r.message;
							if (msg && msg.data) {
								self.tableData = msg.data;
								self.actualDate = msg.actual_date;
							} else {
								self.tableData = Array.isArray(msg) ? msg : [];
								self.actualDate = t1_date;
							}
							self.renderRmWiseTable(container.find("#mis-table-container"), dashboardInstance);
							container.find("#mis-loading").hide();
							container.find("#mis-controls, #mis-table-container").show();
						}
					});
				},
				checkCommissionPermission: function (dashboardInstance, callback) {
					if (dashboardInstance.canViewCommission !== undefined) {
						callback(dashboardInstance.canViewCommission);
						return;
					}

					if (frappe.session.user === "Administrator") {
						dashboardInstance.canViewCommission = true;
						callback(true);
						return;
					}

					frappe.db.get_value("Employee", { user_id: frappe.session.user }, "cxo_level")
						.then(r => {
							const cxo = r && r.message ? (r.message.cxo_level !== undefined ? r.message.cxo_level : r.message) : 0;
							dashboardInstance.canViewCommission = (cint(cxo) === 1);
							callback(dashboardInstance.canViewCommission);
						})
						.catch(err => {
							console.error("Error checking employee cxo_level:", err);
							dashboardInstance.canViewCommission = false;
							callback(false);
						});
				},
				rmDetails: {},
				expandedRms: {},
				customerDetails: {},
				expandedRmCategories: {},
				renderRmWiseTable: function (tableContainer, dashboardInstance) {
					const self = this;
					if (dashboardInstance.canViewCommission === undefined) {
						self.checkCommissionPermission(dashboardInstance, () => {
							self.renderRmWiseTable(tableContainer, dashboardInstance);
						});
						return;
					}
					const canViewComm = !!dashboardInstance.canViewCommission;

					let data = self.tableData || [];
					if (!self.rmDetails) self.rmDetails = {};
					if (!self.expandedRms) self.expandedRms = {};

					// State pagination
					if (!self.currentPage) self.currentPage = 1;
					if (!self.pageSize) self.pageSize = 50;

					if (self.filterQuery) {
						data = data.filter(r => 
							(r.agent_code || r.rm_id || "").toLowerCase().includes(self.filterQuery) ||
							(r.agent_name || r.rm_name || "").toLowerCase().includes(self.filterQuery)
						);
					}

					// Always sort High to Low by Commission
					data.sort((a, b) => (b.total_commission || 0) - (a.total_commission || 0));

					if (data.length === 0) {
						tableContainer.html('<div style="padding: 30px; text-align: center; color: #64748b; font-weight: 600;">No Agent records to display.</div>');
						return;
					}

					const fmtNum = (val) => new Intl.NumberFormat("en-IN").format(val || 0);
					const fmtAmt = (val) => "₹" + dashboardInstance.formatCurrency(val || 0);

					let grandTotalCust = 0;
					let grandTotalComm = 0;
					let totalActive = 0;
					let totalInactive = 0;

					self.tableData.forEach(r => {
						grandTotalCust += (r.total_customer ?? r.total_records ?? 0);
						grandTotalComm += (r.total_commission || 0);

						const st = (r.agent_status || "Inactive").trim().toLowerCase();
						if (st === "active" || st === "live") {
							totalActive++;
						} else {
							totalInactive++;
						}
					});

					const totalAgents = totalActive + totalInactive;

					const kpiCardsHtml = `
						<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 14px;">
							<!-- Card 1: Total Agents (Blue Theme Card) -->
							<div style="background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; align-items: center; justify-content: space-between;">
								<div>
									<div style="font-size: 11px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px;">Total Agents</div>
									<div style="font-size: 22px; font-weight: 800; color: #1d4ed8; margin-top: 2px;">${fmtNum(totalAgents)}</div>
								</div>
								<div style="background: #dbeafe; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px;">
									👥
								</div>
							</div>

							<!-- Card 2: Active Agents (Green Card) -->
							<div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; align-items: center; justify-content: space-between;">
								<div>
									<div style="font-size: 11px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.5px;">Total Active Agents</div>
									<div style="font-size: 22px; font-weight: 800; color: #15803d; margin-top: 2px;">${fmtNum(totalActive)}</div>
								</div>
								<div style="background: #dcfce7; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px;">
									🟢
								</div>
							</div>

							<!-- Card 3: Inactive Agents (Red Card) -->
							<div style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; align-items: center; justify-content: space-between;">
								<div>
									<div style="font-size: 11px; font-weight: 700; color: #991b1b; text-transform: uppercase; letter-spacing: 0.5px;">Total Inactive Agents</div>
									<div style="font-size: 22px; font-weight: 800; color: #dc2626; margin-top: 2px;">${fmtNum(totalInactive)}</div>
								</div>
								<div style="background: #fee2e2; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px;">
									🔴
								</div>
							</div>

							${canViewComm ? `
							<!-- Card 4: Total Commission (Primary Theme Card) -->
							<div style="background: rgba(65, 125, 129, 0.05); border: 1px solid rgba(65, 125, 129, 0.3); border-radius: 8px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); display: flex; align-items: center; justify-content: space-between;">
								<div>
									<div style="font-size: 11px; font-weight: 700; color: #417d81; text-transform: uppercase; letter-spacing: 0.5px;">Total Commission</div>
									<div style="font-size: 22px; font-weight: 800; color: #417d81; margin-top: 2px;">${fmtAmt(grandTotalComm)}</div>
								</div>
								<div style="background: rgba(65, 125, 129, 0.12); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px;">
									💰
								</div>
							</div>
							` : ''}
						</div>
					`;

					if (!self.expandedTreeNodes) self.expandedTreeNodes = {};

					// Build Tree Data (Zone -> Region -> District -> SOL -> Agent)
					const rootNodes = [];
					const zMap = {};

					data.forEach(agent => {
						const zName = (agent.zone || "OTHER ZONE").trim();
						const rName = (agent.region || "OTHER REGION").trim();
						const dName = (agent.district || "OTHER DISTRICT").trim();
						const sCode = (agent.branch_code || "-").trim();
						const sName = (agent.branch_name || sCode).trim();
						const solLabel = sCode !== '-' ? `${sName} (${sCode})` : sName;
						const comm = agent.total_commission || 0;
						const isActive = (agent.agent_status || "").trim().toLowerCase() === "active";

						if (!zMap[zName]) {
							zMap[zName] = {
								id: `z_${zName}`,
								name: zName,
								code: zName,
								type: "Zone",
								level: 1,
								total_commission: 0,
								agent_count: 0,
								active_count: 0,
								inactive_count: 0,
								children: {}
							};
							rootNodes.push(zMap[zName]);
						}
						zMap[zName].total_commission += comm;
						zMap[zName].agent_count += 1;
						if (isActive) zMap[zName].active_count += 1;
						else zMap[zName].inactive_count += 1;

						const rMap = zMap[zName].children;
						if (!rMap[rName]) {
							rMap[rName] = {
								id: `r_${zName}_${rName}`,
								name: rName,
								code: rName,
								type: "Region",
								level: 2,
								total_commission: 0,
								agent_count: 0,
								active_count: 0,
								inactive_count: 0,
								children: {}
							};
						}
						rMap[rName].total_commission += comm;
						rMap[rName].agent_count += 1;
						if (isActive) rMap[rName].active_count += 1;
						else rMap[rName].inactive_count += 1;

						const dMap = rMap[rName].children;
						if (!dMap[dName]) {
							dMap[dName] = {
								id: `d_${zName}_${rName}_${dName}`,
								name: dName,
								code: dName,
								type: "District",
								level: 3,
								total_commission: 0,
								agent_count: 0,
								active_count: 0,
								inactive_count: 0,
								children: {}
							};
						}
						dMap[dName].total_commission += comm;
						dMap[dName].agent_count += 1;
						if (isActive) dMap[dName].active_count += 1;
						else dMap[dName].inactive_count += 1;

						const sMap = dMap[dName].children;
						if (!sMap[sCode]) {
							sMap[sCode] = {
								id: `s_${zName}_${rName}_${dName}_${sCode}`,
								name: solLabel,
								code: sCode,
								type: "SOL",
								level: 4,
								total_commission: 0,
								agent_count: 0,
								active_count: 0,
								inactive_count: 0,
								children: []
							};
						}
						sMap[sCode].total_commission += comm;
						sMap[sCode].agent_count += 1;
						if (isActive) sMap[sCode].active_count += 1;
						else sMap[sCode].inactive_count += 1;

						sMap[sCode].children.push({
							id: `a_${agent.agent_code}`,
							name: agent.agent_name,
							code: agent.agent_code,
							type: "Agent",
							level: 5,
							total_commission: comm,
							agent_status: agent.agent_status,
							raw_agent: agent
						});
					});

					rootNodes.sort((a, b) => b.total_commission - a.total_commission);

					const allNodeIds = [];
					const collectAllNodeIds = (nodes) => {
						nodes.forEach(n => {
							if (n.level < 5) {
								allNodeIds.push(n.id);
								let childList = Array.isArray(n.children) ? n.children : Object.values(n.children);
								collectAllNodeIds(childList);
							}
						});
					};
					collectAllNodeIds(rootNodes);

					const renderTreeRows = (nodes) => {
						let html = "";
						nodes.forEach(node => {
							const isExpanded = !!self.expandedTreeNodes[node.id];
							const indent = (node.level - 1) * 10 + 10;
							const hasChildren = node.level < 5;

							let typeBadgeBg = "#e0f2fe";
							let typeBadgeColor = "#0369a1";
							let typeBadgeBorder = "#7dd3fc";
							if (node.level === 1) { typeBadgeBg = "#f3e8ff"; typeBadgeColor = "#7e22ce"; typeBadgeBorder = "#d8b4fe"; } // Zone
							else if (node.level === 2) { typeBadgeBg = "#e0e7ff"; typeBadgeColor = "#3730a3"; typeBadgeBorder = "#a5b4fc"; } // Region
							else if (node.level === 3) { typeBadgeBg = "#fef3c7"; typeBadgeColor = "#92400e"; typeBadgeBorder = "#fcd34d"; } // District
							else if (node.level === 4) { typeBadgeBg = "#ccfbf1"; typeBadgeColor = "#115e59"; typeBadgeBorder = "#5eead4"; } // SOL
							else if (node.level === 5) { typeBadgeBg = "#dcfce7"; typeBadgeColor = "#15803d"; typeBadgeBorder = "#86efac"; } // Agent

							let activeColHtml = "";
							let inactiveColHtml = "";

							if (node.level < 5) {
								activeColHtml = `<span style="font-size: 12px; font-weight: 700; color: #15803d;">${fmtNum(node.active_count)}</span>`;
								inactiveColHtml = `<span style="font-size: 12px; font-weight: 700; color: #dc2626;">${fmtNum(node.inactive_count)}</span>`;
							} else {
								const st = (node.agent_status || "Inactive").trim().toLowerCase();
								const isAct = st === "active" || st === "live";
								if (isAct) {
									activeColHtml = `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">Active</span>`;
									inactiveColHtml = `<span style="color: #cbd5e1;">-</span>`;
								} else {
									activeColHtml = `<span style="color: #cbd5e1;">-</span>`;
									inactiveColHtml = `<span style="background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">Inactive</span>`;
								}
							}

							let rowBg = '#ffffff';
							if (node.level === 1) rowBg = '#f8fafc';
							else if (node.level === 2) rowBg = '#ffffff';
							else if (node.level === 3) rowBg = '#f8fafc';
							else if (node.level === 4) rowBg = '#ffffff';
							else if (node.level === 5) rowBg = '#f0fdfa';

							html += `
								<tr class="tree-master-row" data-node-id="${node.id}" data-level="${node.level}" data-agent-code="${node.code}" style="cursor: pointer; background: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
									<td style="padding: 8px 12px; text-align: left; padding-left: ${indent}px; font-weight: ${node.level < 5 ? '700' : '600'}; color: #1e293b;">
										${hasChildren ? `<span class="tree-toggle-icon" style="display: inline-block; width: 16px; color: #417d81; font-weight: 800;">${isExpanded ? '▼' : '▶'}</span>` : '<span style="display: inline-block; width: 16px; color: #94a3b8;">•</span>'}
										<span style="color: ${node.level === 5 && canViewComm ? '#417d81' : '#0f172a'}; ${node.level === 5 && canViewComm ? 'text-decoration: underline; font-weight: 700;' : ''}">${node.name}</span>
									</td>
									<td style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #417d81;">${node.code}</td>
									<td style="padding: 8px 12px; text-align: left; font-size: 11px;">
										<span style="background: ${typeBadgeBg}; color: ${typeBadgeColor}; border: 1px solid ${typeBadgeBorder}; padding: 2px 8px; border-radius: 12px; font-weight: 700;">${node.type}</span>
									</td>
									<td style="padding: 8px 12px; text-align: right;">${activeColHtml}</td>
									<td style="padding: 8px 12px; text-align: right;">${inactiveColHtml}</td>
									${canViewComm ? `<td style="padding: 8px 12px; text-align: right; font-size: 13px; font-weight: 800; color: #417d81;">${fmtAmt(node.total_commission)}</td>` : ''}
								</tr>
							`;

							if (hasChildren && isExpanded) {
								let childNodes = [];
								if (Array.isArray(node.children)) {
									childNodes = node.children;
								} else if (typeof node.children === "object") {
									childNodes = Object.values(node.children);
								}
								childNodes.sort((a, b) => b.total_commission - a.total_commission);
								html += renderTreeRows(childNodes);
							}
						});
						return html;
					};

					const treeRowsHtml = renderTreeRows(rootNodes);

					const controlBarHtml = `
						<div class="rm-pagination-bar" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
							<div style="font-size: 12px; font-weight: 700; color: #417d81; display: flex; align-items: center; gap: 8px;">
								<span>🌳 Hierarchical Drill-Down (Zone → Region → District → SOL → Agent)</span>
								<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;">${fmtNum(data.length)} Agents Total</span>
							</div>
							<div style="display: flex; align-items: center; gap: 8px;">
								<button type="button" class="btn btn-xs rm-tree-expand-all" style="background: rgba(65, 125, 129, 0.1); color: #417d81; border: 1px solid rgba(65, 125, 129, 0.3); font-weight: 700; border-radius: 4px; padding: 4px 10px; cursor: pointer;">
									📂 Expand All
								</button>
								<button type="button" class="btn btn-xs rm-tree-collapse-all" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; font-weight: 700; border-radius: 4px; padding: 4px 10px; cursor: pointer;">
									📁 Collapse All
								</button>
							</div>
						</div>
					`;

					const tableHtml = `
						<style>
							.tree-master-row { transition: background-color 0.15s ease-in-out; }
							.tree-master-row:hover { background-color: #f0fdfa !important; }
						</style>
						${kpiCardsHtml}
						${controlBarHtml}
						<div style="max-height: 650px; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
							<table class="table table-sm table-hover" style="width: 100%; border-collapse: separate; border-spacing: 0; margin: 0; font-family: 'Inter', sans-serif;">
								<thead>
									<tr style="background: #417d81; color: #ffffff; position: sticky; top: 0; z-index: 2;">
										<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: left;">Z / R / D / SOL / Agent Name</th>
										<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: left;">Code / ID</th>
										<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: left;">Level</th>
										<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: right;">Active Agents</th>
										<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: right;">Inactive Agents</th>
										${canViewComm ? `<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: right;">Total Commission</th>` : ''}
									</tr>
								</thead>
								<tbody>${treeRowsHtml}</tbody>
								<tfoot>
									<tr style="background: rgba(65, 125, 129, 0.08); color: #1e293b; font-weight: 700; position: sticky; bottom: 0; z-index: 2; border-top: 2px solid #417d81;">
										<td colspan="3" style="padding: 10px 12px; text-align: left; font-size: 12px; color: #417d81;">GRAND TOTAL (${fmtNum(data.length)} AGENTS)</td>
										<td style="padding: 10px 12px; text-align: right; font-size: 12px; color: #15803d; font-weight: 800;">${fmtNum(totalActive)} Active</td>
										<td style="padding: 10px 12px; text-align: right; font-size: 12px; color: #dc2626; font-weight: 800;">${fmtNum(totalInactive)} Inactive</td>
										${canViewComm ? `<td style="padding: 10px 12px; text-align: right; font-size: 13px; color: #417d81; font-weight: 800;">${fmtAmt(grandTotalComm)}</td>` : ''}
									</tr>
								</tfoot>
							</table>
						</div>
					`;

					tableContainer.html(tableHtml);

					// Tree Click Event Handlers
					tableContainer.off("click", ".tree-master-row").on("click", ".tree-master-row", function () {
						const nodeId = $(this).data("node-id");
						const level = parseInt($(this).data("level"));

						if (level < 5) {
							self.expandedTreeNodes[nodeId] = !self.expandedTreeNodes[nodeId];
							self.renderRmWiseTable(tableContainer, dashboardInstance);
						} else if (canViewComm) {
							const agentCode = $(this).data("agent-code");
							const agentData = self.tableData.find(a => (a.agent_code || a.rm_id) === agentCode);
							if (agentData) {
								self.openAgentModal(agentData, dashboardInstance);
							}
						}
					});

					tableContainer.off("click", ".rm-tree-expand-all").on("click", ".rm-tree-expand-all", function () {
						allNodeIds.forEach(id => self.expandedTreeNodes[id] = true);
						self.renderRmWiseTable(tableContainer, dashboardInstance);
					});

					tableContainer.off("click", ".rm-tree-collapse-all").on("click", ".rm-tree-collapse-all", function () {
						self.expandedTreeNodes = {};
						self.renderRmWiseTable(tableContainer, dashboardInstance);
					});

					// Render category details for expanded RMs
					Object.keys(self.expandedRms).forEach(rmId => {
						if (self.expandedRms[rmId]) {
							self.loadAndRenderRmCategoryDetails(rmId, tableContainer, dashboardInstance);
						}
					});

					// Master RM Row Click Event -> Opens Glassmorphic Backdrop-Blurred Modal Popup
					tableContainer.off("click", ".rm-master-row").on("click", ".rm-master-row", function (e) {
						e.stopPropagation();
						const rmId = $(this).data("rm-id");
						const rowData = pagedData.find(r => (r.agent_code || r.rm_id) === rmId) || { agent_code: rmId, agent_name: rmId };
						self.openAgentModal(rowData, dashboardInstance);
					});
				},

				parseAgentCommissionJson: function (comm_dict_or_str, selectedDate) {
					let comm_dict = comm_dict_or_str;
					if (typeof comm_dict_or_str === "string") {
						try { comm_dict = JSON.parse(comm_dict_or_str); } catch (e) { comm_dict = {}; }
					}
					if (!comm_dict || typeof comm_dict !== "object") comm_dict = {};

					const today = selectedDate ? new Date(selectedDate) : new Date();
					const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
					const targetMonths = [];

					for (let i = 3; i >= 0; i--) {
						const dt = new Date(today.getFullYear(), today.getMonth() - i, 1);
						const yStr = String(dt.getFullYear());
						const mStr = String(dt.getMonth() + 1).padStart(2, '0');
						const mName = `${monthNames[dt.getMonth()]} ${dt.getFullYear()}`;
						targetMonths.push({
							year: yStr,
							month: mStr,
							label: mName,
							is_current: (i === 0)
						});
					}

					const standardProducts = ["DAM", "SMBG", "RD", "DD SAV", "FD", "FD 1", "DD TDA", "SHARE"];
					const productMatrix = {};
					standardProducts.forEach(prod => {
						productMatrix[prod] = { product_name: prod, months: {}, total_commission: 0 };
					});

					const monthTotals = {};
					targetMonths.forEach(m => monthTotals[m.label] = 0);
					let grand4mTotal = 0;

					targetMonths.forEach(mInfo => {
						const yr = mInfo.year;
						const mth = mInfo.month;
						const lbl = mInfo.label;

						if (comm_dict[yr] && comm_dict[yr][mth]) {
							const mData = comm_dict[yr][mth];
							standardProducts.forEach(prod => {
								const val = parseFloat(mData[prod] || 0);
								productMatrix[prod].months[lbl] = val;
								productMatrix[prod].total_commission += val;
								monthTotals[lbl] += val;
								grand4mTotal += val;
							});
						} else {
							standardProducts.forEach(prod => {
								productMatrix[prod].months[lbl] = 0;
							});
						}
					});

					const breakdownList = standardProducts.map(prod => {
						const pData = productMatrix[prod];
						return {
							product_name: prod,
							report_type: prod,
							months: pData.months,
							total_commission: pData.total_commission,
							total_customer: pData.total_commission > 0 ? 1 : 0
						};
					});

					breakdownList.sort((a, b) => b.total_commission - a.total_commission);

					return {
						breakdown: breakdownList,
						target_months: targetMonths,
						month_totals: monthTotals,
						grand_4m_total: grand4mTotal,
						comm_dict: comm_dict
					};
				},

				openAgentModal: function (agentData, dashboardInstance) {
					const self = this;
					const agentCode = agentData.agent_code || agentData.rm_id || "-";
					const agentName = agentData.agent_name || agentData.rm_name || "-";
					const agentStatus = (agentData.agent_status || "Inactive").trim();
					const isAgentActive = agentStatus.toLowerCase() === "active" || agentStatus.toLowerCase() === "live";

					const fmtNum = (val) => new Intl.NumberFormat("en-IN").format(val || 0);
					const fmtAmt = (val) => "₹" + dashboardInstance.formatCurrency(val || 0);

					const modalId = "agent-breakdown-modal-backdrop";
					$(`#${modalId}`).remove();

					const statusBadge = isAgentActive
						? `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 3px 10px; border-radius: 14px; font-size: 11px; font-weight: 700;">Active</span>`
						: `<span style="background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; padding: 3px 10px; border-radius: 14px; font-size: 11px; font-weight: 700;">Inactive</span>`;

					const modalHtml = `
						<style>
							@keyframes agentModalPop {
								0% { opacity: 0; transform: scale(0.95) translateY(10px); }
								100% { opacity: 1; transform: scale(1) translateY(0); }
							}
							.modal-table-row { transition: background-color 0.15s ease-in-out; }
							.modal-table-row:hover { background-color: #f0fdfa !important; cursor: pointer; }
						</style>
						<div id="${modalId}" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px;">
							<div style="background: #ffffff; width: 100%; max-width: 980px; border-radius: 12px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25); overflow: hidden; animation: agentModalPop 0.25s ease-out;">
								
								<!-- Modal Header -->
								<div style="background: #417d81; color: #ffffff; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;">
									<div>
										<div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; opacity: 0.85;">Agent Profile & Commission Breakdown</div>
										<div style="font-size: 18px; font-weight: 800; margin-top: 2px; display: flex; align-items: center; gap: 10px;">
											<span>${agentName} (${agentCode})</span>
											${statusBadge}
										</div>
									</div>
									<button type="button" id="close-agent-modal" style="background: rgba(255,255,255,0.15); border: none; color: #ffffff; font-size: 20px; font-weight: 700; width: 34px; height: 34px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.15s;">✕</button>
								</div>

								<!-- Modal Body -->
								<div style="padding: 20px; max-height: 80vh; overflow-y: auto;">
									<div id="modal-subtable-content">
										<div style="padding: 40px; text-align: center; color: #417d81; font-weight: 600; font-size: 13px;">
											⏳ Fetching Agent Profile & Product Breakdown for ${agentCode}...
										</div>
									</div>
								</div>

								<!-- Modal Footer -->
								<div style="padding: 12px 20px; background: #f8fafc; border-top: 1px solid #e2e8f0; text-align: right;">
									<button type="button" id="close-agent-modal-btn" class="btn btn-sm" style="background: #417d81; color: #ffffff; font-weight: 700; border-radius: 6px; padding: 6px 16px;">Close</button>
								</div>
							</div>
						</div>
					`;

					$("body").append(modalHtml);

					const closeModal = () => {
						$(`#${modalId}`).fadeOut(150, function () { $(this).remove(); });
					};

					$(`#${modalId}`).on("click", function (e) {
						if (e.target.id === modalId) closeModal();
					});
					$("#close-agent-modal, #close-agent-modal-btn").on("click", closeModal);

					$(document).off("keydown.agentModal").on("keydown.agentModal", function (e) {
						if (e.key === "Escape") {
							closeModal();
							$(document).off("keydown.agentModal");
						}
					});

					const renderModalContent = (res) => {
						const catList = res.breakdown || [];
						const targetMonths = res.target_months || [];
						const monthTotals = res.month_totals || {};
						const grand4mTotal = res.grand_4m_total || 0;

						if (catList.length === 0) {
							$("#modal-subtable-content").html('<div style="padding: 20px; text-align: center; color: #64748b; font-weight: 600;">No product breakdown data found.</div>');
							return;
						}

						catList.sort((a, b) => (b.total_commission || 0) - (a.total_commission || 0));

						let maxMonthVal = 0;
						targetMonths.forEach(m => {
							const val = monthTotals[m.label] || 0;
							if (val > maxMonthVal) maxMonthVal = val;
						});
						if (maxMonthVal === 0) maxMonthVal = 1;

						let barChartItemsHtml = targetMonths.map(m => {
							const val = monthTotals[m.label] || 0;
							const pctHeight = Math.max(Math.round((val / maxMonthVal) * 85), val > 0 ? 8 : 2);
							const isCurrent = m.is_current;
							const barBg = isCurrent
								? "linear-gradient(180deg, #22c55e 0%, #15803d 100%)"
								: "linear-gradient(180deg, #417d81 0%, #2b5558 100%)";
							const labelColor = isCurrent ? "#15803d" : "#417d81";

							return `
								<div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; position: relative;">
									<div style="font-size: 11px; font-weight: 800; color: ${val > 0 ? labelColor : '#94a3b8'}; margin-bottom: 4px; white-space: nowrap;">
										${val > 0 ? fmtAmt(val) : '₹0'}
									</div>
									<div style="width: 75%; max-width: 48px; height: ${pctHeight}%; background: ${barBg}; border-radius: 6px 6px 0 0; transition: height 0.3s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.08);" title="${m.label}: ${fmtAmt(val)}"></div>
									<div style="font-size: 11px; font-weight: 700; color: ${isCurrent ? '#15803d' : '#475569'}; margin-top: 8px; text-transform: uppercase;">
										${m.label} ${isCurrent ? '⚡' : ''}
									</div>
								</div>
							`;
						}).join('');

						const barChartCardHtml = `
							<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
								<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
									<div style="font-size: 12px; font-weight: 800; color: #417d81; text-transform: uppercase; letter-spacing: 0.5px;">
										📈 4-Month Commission Trend Bar Chart
									</div>
									<div style="font-size: 11px; font-weight: 700; color: #64748b;">
										Grand 4-Month Total: <span style="color: #417d81; font-weight: 800;">${fmtAmt(grand4mTotal)}</span>
									</div>
								</div>
								<div style="height: 150px; display: flex; align-items: flex-end; gap: 16px; padding: 12px 20px 0 20px; background: #f8fafc; border-radius: 6px; border: 1px solid #f1f5f9;">
									${barChartItemsHtml}
								</div>
							</div>
						`;

						let monthHeadersHtml = targetMonths.map(m => `
							<th style="padding: 10px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; text-align: right; ${m.is_current ? 'background: #35676a;' : ''}">${m.label}</th>
						`).join('');

						let rowsHtml = "";
						catList.forEach((c, idx) => {
							const prodName = c.product_name || c.report_type || "-";
							const totComm = c.total_commission || 0;

							let monthCellsHtml = targetMonths.map(m => {
								const mVal = (c.months && c.months[m.label]) || 0;
								return `
									<td style="padding: 8px 10px; text-align: right; font-size: 12px; font-weight: ${mVal > 0 ? '700' : '500'}; color: ${mVal > 0 ? (m.is_current ? '#15803d' : '#334155') : '#94a3b8'};">
										${mVal > 0 ? fmtAmt(mVal) : '-'}
									</td>
								`;
							}).join('');

							rowsHtml += `
								<tr class="modal-table-row" style="border-bottom: 1px solid #e2e8f0; background: ${totComm > 0 ? '#ffffff' : '#f8fafc'};">
									<td style="padding: 8px 10px; text-align: center; font-size: 12px; font-weight: 600; color: #64748b; width: 40px;">${idx + 1}</td>
									<td style="padding: 8px 10px; font-size: 12px; font-weight: 700; color: #1e293b;">${prodName}</td>
									${monthCellsHtml}
									<td style="padding: 8px 10px; text-align: right; font-size: 12px; font-weight: 800; color: #417d81;">${fmtAmt(totComm)}</td>
								</tr>
							`;
						});

						let monthFootersHtml = targetMonths.map(m => {
							const mTot = monthTotals[m.label] || 0;
							return `
								<td style="padding: 8px 10px; text-align: right; font-size: 12px; font-weight: 800;">${fmtAmt(mTot)}</td>
							`;
						}).join('');

						const agentInfo = res.agent_info || {};
						const bName = agentInfo.branch_name || agentData.branch_name || "-";
						const bCode = agentInfo.branch_code || agentData.branch_code || "-";
						const bZone = agentInfo.zone || agentData.zone || "";
						const bRegion = agentInfo.region || agentData.region || "";
						const bDistrict = agentInfo.district || agentData.district || "";
						const authId = agentInfo.auth_id || agentData.auth_id || "-";
						const empId = agentInfo.employee || agentData.employee || "-";
						const empName = agentInfo.employee_name || agentData.employee_name || "";
						const empDesignation = agentInfo.emp_designation || agentData.emp_designation || "";
						const empDept = agentInfo.emp_department || agentData.emp_department || "";
						const empBranch = agentInfo.emp_branch || agentData.emp_branch || "";
						const empCell = agentInfo.emp_cell_number || agentData.emp_cell_number || "";
						const phoneNo = agentInfo.phone_number || agentData.phone_number || "-";
						const agentRole = agentInfo.role || agentData.role || agentData.agent_type || "-";

						const leftColumnCardsHtml = `
							<div style="display: flex; flex-direction: column; gap: 14px;">
								<!-- CARD 1: AGENT PROFILE CARD -->
								<div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
									<div style="font-size: 11px; font-weight: 800; color: #417d81; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
										<span>Agent Profile</span>
										${statusBadge}
									</div>
									<div style="display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px; margin-bottom: 10px;">
										<div style="width: 44px; height: 44px; background: #417d81; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 3px 6px rgba(65, 125, 129, 0.3);">
											<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
												<circle cx="12" cy="7" r="4"></circle>
											</svg>
										</div>
										<div>
											<div style="font-size: 13px; font-weight: 800; color: #0f172a; line-height: 1.2;">${agentName}</div>
											<div style="font-size: 11px; font-weight: 700; color: #417d81; margin-top: 2px;">${agentCode} ${agentRole !== '-' ? '(' + agentRole + ')' : ''}</div>
										</div>
									</div>
									<div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px;">
										<div>
											<span style="color: #64748b; font-weight: 600;">Branch:</span>
											<strong style="color: #1e293b;">${bName} ${bCode !== '-' ? '(' + bCode + ')' : ''}</strong>
										</div>
										${bZone ? `
										<div>
											<span style="color: #64748b; font-weight: 600;">Zone:</span>
											<strong style="color: #1e293b;">${bZone}</strong>
										</div>
										` : ''}
										${bRegion ? `
										<div>
											<span style="color: #64748b; font-weight: 600;">Region:</span>
											<strong style="color: #1e293b;">${bRegion}</strong>
										</div>
										` : ''}
										${bDistrict ? `
										<div>
											<span style="color: #64748b; font-weight: 600;">District:</span>
											<strong style="color: #1e293b;">${bDistrict}</strong>
										</div>
										` : ''}
										<div>
											<span style="color: #64748b; font-weight: 600;">Auth ID:</span>
											<strong style="color: #1e293b;">${authId}</strong>
										</div>
										${phoneNo !== '-' ? `
										<div>
											<span style="color: #64748b; font-weight: 600;">Phone:</span>
											<strong style="color: #1e293b;">${phoneNo}</strong>
										</div>
										` : ''}
									</div>
								</div>

								<!-- CARD 2: ASSIGNED EMPLOYEE / MANAGER CARD -->
								${empId !== '-' ? `
								<div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
									<div style="font-size: 11px; font-weight: 800; color: #334155; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
										<span>Assigned Employee</span>
										<span style="background: #e2e8f0; color: #334155; padding: 2px 6px; border-radius: 8px; font-size: 10px; font-weight: 700;">ID: ${empId}</span>
									</div>
									<div style="display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 10px;">
										<div style="width: 44px; height: 44px; background: #334155; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 3px 6px rgba(51, 65, 85, 0.3);">
											<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
												<circle cx="9" cy="7" r="4"></circle>
												<path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
												<path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
											</svg>
										</div>
										<div>
											<div style="font-size: 13px; font-weight: 800; color: #0f172a; line-height: 1.2;">${empName || empId}</div>
											<div style="font-size: 11px; font-weight: 700; color: #64748b; margin-top: 2px;">${empDesignation || 'Branch Manager'}</div>
										</div>
									</div>
									<div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px;">
										${empDept ? `
										<div>
											<span style="color: #64748b; font-weight: 600;">Department:</span>
											<strong style="color: #1e293b;">${empDept}</strong>
										</div>
										` : ''}
										${empBranch ? `
										<div>
											<span style="color: #64748b; font-weight: 600;">Emp Branch:</span>
											<strong style="color: #1e293b;">${empBranch}</strong>
										</div>
										` : ''}
										${empCell ? `
										<div>
											<span style="color: #64748b; font-weight: 600;">Contact:</span>
											<strong style="color: #1e293b;">${empCell}</strong>
										</div>
										` : ''}
									</div>
								</div>
								` : ''}

								<!-- CARD 3: 4-MONTH TOTAL ACCENT CARD -->
								<div style="background: rgba(65, 125, 129, 0.08); border: 1px solid rgba(65, 125, 129, 0.25); border-radius: 8px; padding: 10px; text-align: center;">
									<div style="font-size: 10px; font-weight: 700; color: #417d81; text-transform: uppercase;">4-Month Total Commission</div>
									<div style="font-size: 17px; font-weight: 800; color: #417d81; margin-top: 2px;">${fmtAmt(grand4mTotal)}</div>
								</div>
							</div>
						`;

						const modalBodyHtml = `
							<div style="display: grid; grid-template-columns: 260px 1fr; gap: 16px; align-items: start;">
								${leftColumnCardsHtml}
								<div style="display: flex; flex-direction: column; gap: 14px;">
									${barChartCardHtml}
									<div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
										<table class="table table-sm" style="width: 100%; border-collapse: separate; border-spacing: 0; margin: 0; font-family: 'Inter', sans-serif;">
											<thead>
												<tr style="background: #417d81; color: #ffffff;">
													<th style="padding: 10px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; text-align: center; width: 40px;">Sr</th>
													<th style="padding: 10px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; text-align: left;">Product</th>
													${monthHeadersHtml}
													<th style="padding: 10px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; text-align: right;">4-Mo Total</th>
												</tr>
											</thead>
											<tbody>${rowsHtml}</tbody>
											<tfoot>
												<tr style="background: rgba(65, 125, 129, 0.08); font-weight: 800; color: #417d81; border-top: 2px solid #417d81;">
													<td colspan="2" style="padding: 8px 10px; text-align: right; font-size: 12px;">TOTAL:</td>
													${monthFootersHtml}
													<td style="padding: 8px 10px; text-align: right; font-size: 12px; font-weight: 800; color: #417d81;">${fmtAmt(grand4mTotal)}</td>
												</tr>
											</tfoot>
										</table>
									</div>
								</div>
							</div>
						`;

						$("#modal-subtable-content").html(modalBodyHtml);
					};

					if (agentData.commission_json) {
						const resInstant = self.parseAgentCommissionJson(agentData.commission_json);
						resInstant.agent_info = {
							branch_code: agentData.branch_code,
							branch_name: agentData.branch_name,
							zone: agentData.zone,
							region: agentData.region,
							district: agentData.district,
							auth_id: agentData.auth_id,
							employee: agentData.employee,
							employee_name: agentData.employee_name,
							emp_designation: agentData.emp_designation,
							emp_department: agentData.emp_department,
							emp_branch: agentData.emp_branch,
							emp_cell_number: agentData.emp_cell_number,
							phone_number: agentData.phone_number,
							role: agentData.role
						};
						renderModalContent(resInstant);
					} else {
						const t1_date = frappe.datetime.add_days(frappe.datetime.get_today(), -1);
						frappe.call({
							method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_rm_wise_category_breakdown",
							args: { rm_id: agentCode, selected_date: t1_date },
							callback: function (r) {
								renderModalContent(r.message || {});
							}
						});
					}
				},

				loadAndRenderRmCategoryDetails: function (rmId, tableContainer, dashboardInstance) {
					const self = this;
					const $container = tableContainer.find(`.rm-category-container[data-rm-id="${rmId}"]`);
					if (!$container.length) return;

					if (self.rmDetails[rmId]) {
						self.renderRmCategorySubTable(rmId, self.rmDetails[rmId], $container, dashboardInstance);
						return;
					}

					const t1_date = frappe.datetime.add_days(frappe.datetime.get_today(), -1);
					$container.html('<div style="padding: 8px; color: #16a34a; font-weight: 600; font-size: 12px;">⏳ Fetching Product Breakdown for Agent ' + rmId + '...</div>');

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_rm_wise_category_breakdown",
						args: {
							rm_id: rmId,
							selected_date: t1_date
						},
						callback: function (r) {
							if (r.message) {
								self.rmDetails[rmId] = r.message;
								self.renderRmCategorySubTable(rmId, r.message, $container, dashboardInstance);
							} else {
								$container.html('<div style="padding: 8px; color: #64748b; font-weight: 600;">No product breakdown found for this Agent.</div>');
							}
						}
					});
				},

				renderRmCategorySubTable: function (rmId, catList, $container, dashboardInstance) {
					const self = this;
					const fmtNum = (val) => new Intl.NumberFormat("en-IN").format(val || 0);
					const fmtAmt = (val) => "₹" + dashboardInstance.formatCurrency(val || 0);

					if (!catList || catList.length === 0) {
						$container.html('<div style="padding: 8px; color: #64748b; font-size: 12px;">No product breakdown found.</div>');
						return;
					}

					let totalCustSum = 0;
					let totalCommSum = 0;

					let rowsHtml = "";
					catList.forEach((c, idx) => {
						const prodName = c.product_name || c.report_type || "-";
						const totCust = c.total_customer ?? c.record_count ?? 0;
						const totComm = c.total_commission || 0;

						totalCustSum += totCust;
						totalCommSum += totComm;

						rowsHtml += `
							<tr class="rm-sub-product-row" style="border-bottom: 1px solid #e2e8f0; background: #fff; cursor: pointer;">
								<td style="padding: 6px 10px; text-align: center; font-size: 12px; width: 40px;">${idx + 1}</td>
								<td style="padding: 6px 10px; font-size: 12px; font-weight: 700; color: #1e293b;">${prodName}</td>
								<td style="padding: 6px 10px; text-align: right; font-size: 12px;">${fmtNum(totCust)}</td>
								<td style="padding: 6px 10px; text-align: right; font-size: 12px; font-weight: 600; color: #059669;">${fmtAmt(totComm)}</td>
							</tr>
						`;
					});

					$container.html(`
						<div style="background: #ffffff; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px;">
							<div style="font-weight: 700; font-size: 12px; color: #15803d; margin-bottom: 6px;">Product Breakdown for Agent ${rmId} (${catList.length} Products)</div>
							<div style="border: 1px solid #dcfce7; border-radius: 4px;">
								<table class="table table-sm" style="width: 100%; border-collapse: separate; border-spacing: 0; margin: 0;">
									<thead>
										<tr style="background: #f0fdf4; color: #166534; position: sticky; top: 0; z-index: 2; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
											<th style="padding: 6px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; text-align: center; width: 40px; background: #f0fdf4;">Sr</th>
											<th style="padding: 6px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; text-align: left; background: #f0fdf4;">Product</th>
											<th style="padding: 6px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; text-align: right; background: #f0fdf4;">total Customer</th>
											<th style="padding: 6px 10px; font-weight: 700; font-size: 11px; text-transform: uppercase; text-align: right; background: #f0fdf4;">Total Commission</th>
										</tr>
									</thead>
									<tbody>${rowsHtml}</tbody>
									<tfoot>
										<tr style="background: #f8fafc; font-weight: 700; color: #1e293b; position: sticky; bottom: 0; z-index: 2; border-top: 1px solid #cbd5e1;">
											<td colspan="2" style="padding: 6px 10px; text-align: right; font-size: 12px; background: #f8fafc;">Total:</td>
											<td style="padding: 6px 10px; text-align: right; font-size: 12px; background: #f8fafc;">${fmtNum(totalCustSum)}</td>
											<td style="padding: 6px 10px; text-align: right; font-size: 12px; color: #059669; background: #f8fafc;">${fmtAmt(totalCommSum)}</td>
										</tr>
									</tfoot>
								</table>
							</div>
						</div>
					`);

					// Render details for expanded RM Categories
					Object.keys(self.expandedRmCategories).forEach(key => {
						if (self.expandedRmCategories[key] && key.startsWith(rmId + "::")) {
							const rType = key.split("::")[1];
							self.loadAndRenderRmCatCustomerDetails(rmId, rType, $container, dashboardInstance);
						}
					});

					// Category row click handler
					$container.off("click", ".rm-cat-row").on("click", ".rm-cat-row", function (e) {
						e.stopPropagation();
						const rType = $(this).data("type");
						const key = rmId + "::" + rType;
						self.expandedRmCategories[key] = !self.expandedRmCategories[key];
						const isExp = self.expandedRmCategories[key];

						$(this).css("background", isExp ? "#eff6ff" : "#fff");
						$(this).find(".rm-cat-toggle-icon").text(isExp ? "▼" : "▶");

						const $custRow = $container.find(`.rm-cat-cust-row[data-rm-id="${rmId}"][data-type="${rType}"]`);
						if (isExp) {
							$custRow.show();
							self.loadAndRenderRmCatCustomerDetails(rmId, rType, $container, dashboardInstance);
						} else {
							$custRow.hide();
						}
					});
				},

				loadAndRenderRmCatCustomerDetails: function (rmId, rType, $container, dashboardInstance) {
					const self = this;
					const key = rmId + "::" + rType;
					const $custContainer = $container.find(`.rm-cat-cust-container[data-rm-id="${rmId}"][data-type="${rType}"]`);
					if (!$custContainer.length) return;

					if (self.customerDetails[key]) {
						self.renderRmCustomerSubTable(self.customerDetails[key], $custContainer, dashboardInstance);
						return;
					}

					const t1_date = frappe.datetime.add_days(frappe.datetime.get_today(), -1);
					$custContainer.html('<div style="padding: 8px; color: #2563eb; font-weight: 600; font-size: 11px;">⏳ Loading Customer Accounts...</div>');

					frappe.call({
						method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_agent_customer_details",
						args: {
							report_type: rType,
							rm_id: rmId,
							selected_date: t1_date
						},
						callback: function (r) {
							if (r.message) {
								self.customerDetails[key] = r.message;
								self.renderRmCustomerSubTable(r.message, $custContainer, dashboardInstance);
							} else {
								$custContainer.html('<div style="padding: 8px; color: #64748b; font-weight: 600; font-size: 11px;">No customer accounts found.</div>');
							}
						}
					});
				},

				renderRmCustomerSubTable: function (customerList, $custContainer, dashboardInstance) {
					const fmtAmt = (val) => "₹" + dashboardInstance.formatCurrency(val || 0);

					if (!customerList || customerList.length === 0) {
						$custContainer.html('<div style="padding: 8px; color: #64748b; font-size: 11px;">No customer accounts found.</div>');
						return;
					}

					const rowsHtml = customerList.map((c, idx) => `
						<tr style="border-bottom: 1px solid #e2e8f0; background: #fff;">
							<td style="padding: 5px 8px; text-align: center; font-size: 11px; width: 35px;">${idx + 1}</td>
							<td style="padding: 5px 8px; font-size: 11px; font-weight: 700; color: #0f172a;">${c.foracid || "-"}</td>
							<td style="padding: 5px 8px; font-size: 11px; font-weight: 600; color: #1e293b;">${c.acct_name || "-"}</td>
							<td style="padding: 5px 8px; font-size: 11px; color: #475569;">${c.operative_account_number || "-"}</td>
							<td style="padding: 5px 8px; text-align: right; font-size: 11px; font-weight: 600; color: #059669;">${fmtAmt(c.commission)}</td>
						</tr>
					`).join("");

					$custContainer.html(`
						<div style="background: #f8fafc; border: 1px solid #bfdbfe; border-radius: 4px; padding: 8px;">
							<div style="font-weight: 700; font-size: 11px; color: #1e40af; margin-bottom: 6px;">Customer Accounts (${customerList.length} Accounts)</div>
							<div style="max-height: 200px; overflow-y: auto; border: 1px solid #dbeafe; border-radius: 4px;">
								<table class="table table-sm" style="width: 100%; border-collapse: separate; border-spacing: 0; margin: 0;">
									<thead>
										<tr style="background: #e0f2fe; color: #0369a1;">
											<th style="padding: 4px 8px; font-weight: 600; font-size: 10px; text-transform: uppercase; text-align: center; width: 35px;">Sr</th>
											<th style="padding: 4px 8px; font-weight: 600; font-size: 10px; text-transform: uppercase; text-align: left;">Foracid (Account No)</th>
											<th style="padding: 4px 8px; font-weight: 600; font-size: 10px; text-transform: uppercase; text-align: left;">Customer Name (acct_name)</th>
											<th style="padding: 4px 8px; font-weight: 600; font-size: 10px; text-transform: uppercase; text-align: left;">Agent Operative Account</th>
											<th style="padding: 4px 8px; font-weight: 600; font-size: 10px; text-transform: uppercase; text-align: right;">Commission</th>
										</tr>
									</thead>
									<tbody>${rowsHtml}</tbody>
								</table>
							</div>
						</div>
					`);
				}
			}
		];

		this.init();
	}

	checkUserDesignation() {
		const currentUser = frappe.session.user;
		frappe.db.get_value("Employee", { user_id: currentUser }, ["name", "employee_name", "designation"])
			.then(r => {
				const emp = r && r.message ? r.message : null;
				const designation = emp ? (emp.designation || "") : "";
				const isBranchManager = designation.toLowerCase().includes("branch manager");

				console.log("[Sahayog Dashboard] Logged in User:", currentUser);
				console.log("[Sahayog Dashboard] Employee Designation:", designation);
				console.log("[Sahayog Dashboard] Is Branch Manager?:", isBranchManager);

				this.isBranchManager = isBranchManager;
				if (isBranchManager) {
					this.applyBranchManagerRestrictions();
				}
			})
			.catch(err => {
				console.error("[Sahayog Dashboard] Error checking employee designation:", err);
			});
	}

	applyBranchManagerRestrictions() {
		if (this.isBranchManager) {
			this.page.main
				.find('.tab-btn[data-tab="zone"], .tab-btn[data-tab="category"], .tab-btn[data-tab="product"], .tab-btn[data-tab="agent"]')
				.hide();

			if (["zone", "category", "product", "agent"].includes(this.state.activeTab)) {
				this.switchTab("branch");
			}
		}
	}

	init() {
		this.checkUserDesignation();
		this.setupLegacyStyles();
		this.setupStyles();
		this.setupBranchProfilePopup();

		// Create wrappers for Drishti and MIS Dashboards to toggle visibility easily
		this.drishti_container = $('<div id="drishti-dashboard-container"></div>').appendTo(this.page.main);
		this.mis_container = null;

		this.createControls();
		this.createFilterTags();
		this.createTabsAndContainer();
		this.initDatePicker();
		this.updateStateFromUrl(); // Read from URL and update state
		this.updateUiFromState(); // Update UI from state
		this.loadFinancialYears();
		this.switchDashboardMode(this.state.dashboardMode);
	}

	resetAllCaches() {
		// Reset data loading flag so loadData() always fetches fresh
		this._dataLoaded = false;

		// Clear all cached API data
		this.data = null;
		this.branchData = null;
		this.zoneData = null;
		this.categoryData = null;
		this.productData = [];
		this.allProducts = [];
		this.agentData = [];
		this.months = [];

		// Clear expanded/collapsed state
		this.state.expandedZones = {};
		this.state.expandedZoneRegions = {};
		this.state.checkedZoneRows = {};
		this.state.expandedProductRows = {};
		this.state.checkedProductRows = {};

		// Clear MIS report caches
		this.misReportsList.forEach((report) => {
			if (report.type === "group") return;
			report.rawTableData = [];
			report.tableData = [];
			report.filterOptions = null;
			report.loadedUser = null;
			report.expandedZones = {};
			report.expandedRegions = {};
			report.checkedRows = {};
			report.searchTerm = "";
			report.allExpanded = false;
			report.selectedMisZones = [];
			// Cust Wise AVG Balance specific
			if (report.cachedPages !== undefined) {
				report.cachedPages = {};
				report.currentPage = 1;
				report.totalRows = 0;
				report.totalPages = 0;
				report._bgRunning = false;
			}
		});

		// Increment MIS render sequence to cancel in-flight renders
		this._misRenderSeq = (this._misRenderSeq || 0) + 1;

		// Show loading skeleton in data container
		const dataContainer = this.page.main.find("#data-container");
		if (dataContainer.length) {
			dataContainer.css("opacity", 0);
			dataContainer.html(this._buildLoadingSkeleton());
		}

		// Show loading in summary cards
		const summaryContainer = this.page.main.find("#summary-cards-container");
		if (summaryContainer.length) {
			summaryContainer.hide();
		}

		// Hide error message
		this.page.main.find("#error-message").hide();
	}

	_buildLoadingSkeleton() {
		return `
			<style>
				@keyframes drishti-shimmer {
					0% { background-position: 400px 0; }
					100% { background-position: -400px 0; }
				}
				.drishti-skeleton { background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%); background-size: 800px 100%; animation: drishti-shimmer 1.5s ease-in-out infinite; border-radius: 4px; }
			</style>
			<div style="padding: 16px; font-family: 'Inter', sans-serif;">
				<div style="display: flex; gap: 12px; margin-bottom: 16px;">
					${[1,2,3,4].map(() => `<div class="drishti-skeleton" style="flex: 1; height: 80px; border-radius: 8px;"></div>`).join('')}
				</div>
				<div style="display: flex; gap: 8px; margin-bottom: 12px;">
					${[1,2,3,4,5,6].map(() => `<div class="drishti-skeleton" style="width: 90px; height: 32px; border-radius: 6px;"></div>`).join('')}
				</div>
				<div class="drishti-skeleton" style="width: 100%; height: 36px; border-radius: 6px; margin-bottom: 4px;"></div>
				<div class="drishti-skeleton" style="width: 100%; height: 36px; border-radius: 6px; margin-bottom: 4px;"></div>
				<div class="drishti-skeleton" style="width: 100%; height: 36px; border-radius: 6px; margin-bottom: 4px;"></div>
				<div class="drishti-skeleton" style="width: 100%; height: 36px; border-radius: 6px; margin-bottom: 4px;"></div>
				<div class="drishti-skeleton" style="width: 70%; height: 36px; border-radius: 6px;"></div>
			</div>
		`;
	}

	buildMisSkeletonTable(label) {
		const isPta = (label || "").includes("Product Wise TGT VS ACH");

		let headersHtml = "";
		let tableHeaderHtml = "";
		let rowsHtml = "";

		if (isPta) {
			const products = ["CASA", "DAM", "DD", "FD", "RD", "SMBG"];
			tableHeaderHtml = `
				<thead>
					<tr style="background: linear-gradient(180deg, #417d81 0%, #346569 100%); color: #ffffff;">
						<th rowspan="2" style="width: 40px; text-align: center; vertical-align: middle;"><div class="mis-skeleton-pulse" style="width: 14px; height: 14px; margin: auto;"></div></th>
						<th rowspan="2" style="width: 80px; text-align: center; vertical-align: middle;">Level</th>
						<th rowspan="2" style="min-width: 200px; text-align: left; padding-left: 12px; vertical-align: middle;">Z / R / D / SOL</th>
						${products.map(p => `<th colspan="2" style="text-align: center; border-left: 1px solid rgba(255,255,255,0.2); font-weight: 800; padding: 8px;">${p}</th>`).join('')}
						<th rowspan="2" style="text-align: center; border-left: 2px solid rgba(255,255,255,0.4); background: #264a4d; font-weight: 800; padding: 8px; vertical-align: middle; min-width: 160px;">OVERALL TOTAL</th>
					</tr>
					<tr style="background: #315e61; color: #ffffff; font-size: 11px;">
						${products.map(p => `
							<th style="width: 100px; text-align: center; padding: 4px; border-left: 1px solid rgba(255,255,255,0.15);">TGT</th>
							<th style="width: 120px; text-align: center; padding: 4px;">ACH</th>
						`).join('')}
					</tr>
				</thead>
			`;

			rowsHtml = [1,2,3,4,5,6,7,8].map(i => `
				<tr style="background: ${i%2===0 ? '#f8fafc' : '#fff'};">
					<td><div class="mis-skeleton-pulse" style="width: 14px; height: 14px; margin: auto;"></div></td>
					<td><div class="mis-skeleton-pulse" style="width: 50px; margin: auto;"></div></td>
					<td><div class="mis-skeleton-pulse" style="width: ${120 + Math.random()*60}px;"></div></td>
					${products.map(() => `
						<td><div class="mis-skeleton-pulse" style="width: 70px; margin-left: auto;"></div></td>
						<td><div class="mis-skeleton-pulse" style="width: 70px; margin-left: auto;"></div></td>
					`).join('')}
					<td><div class="mis-skeleton-pulse" style="width: 130px; margin-left: auto;"></div></td>
				</tr>
			`).join('');
		} else {
			headersHtml = `
				<th style="width: 30px;"><div class="mis-skeleton-pulse" style="width: 14px; height: 14px;"></div></th>
				<th style="width: 40px; text-align: center;">Sr</th>
				<th>Z / R / D / SOL Name</th>
				<th style="text-align: center; width: 80px;">Branches</th>
				<th style="text-align: right; width: 100px;">Accounts</th>
				<th style="text-align: right; width: 120px;">Collection</th>
				<th style="text-align: right; width: 110px;">Pending</th>
			`;
			tableHeaderHtml = `<thead><tr>${headersHtml}</tr></thead>`;

			rowsHtml = [1,2,3,4,5,6].map(i => `
				<tr style="background: ${i%2===0 ? '#f8fafc' : '#fff'};">
					<td><div class="mis-skeleton-pulse" style="width: 14px; height: 14px; margin: auto;"></div></td>
					<td><div class="mis-skeleton-pulse" style="width: 20px; margin: auto;"></div></td>
					<td><div class="mis-skeleton-pulse" style="width: ${120 + Math.random()*60}px;"></div></td>
					<td><div class="mis-skeleton-pulse" style="width: 30px; margin: auto;"></div></td>
					<td><div class="mis-skeleton-pulse" style="width: ${50 + Math.random()*30}px; margin-left: auto;"></div></td>
					<td><div class="mis-skeleton-pulse" style="width: ${60 + Math.random()*30}px; margin-left: auto;"></div></td>
					<td><div class="mis-skeleton-pulse" style="width: ${50 + Math.random()*20}px; margin-left: auto;"></div></td>
				</tr>
			`).join('');
		}

		return `
			<style>
				.mis-skeleton-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; background: #fff; }
				.mis-skeleton-table th { background: #f1f5f9; padding: 10px 12px; border-bottom: 1px solid #cbd5e1; font-weight: 600; font-size: 12px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }
				.mis-skeleton-table td { padding: 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
				.mis-skeleton-pulse { background: linear-gradient(-90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%); background-size: 400% 400%; animation: mis-shimmer 1.5s ease-in-out infinite; border-radius: 4px; height: 16px; }
				@keyframes mis-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
			<div style="padding: 16px 0;">
				<div style="font-size: 13px; font-weight: 600; color: #417d81; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
					<div class="spinner-border text-primary" role="status" style="width: 1.2rem; height: 1.2rem; border-width: 0.15em; color: #417d81 !important; animation: spinner-border .75s linear infinite;"></div>
					<span>${label || "Fetching data..."}</span>
				</div>
				<div style="overflow-x: auto; max-height: 75vh;">
					<table class="mis-skeleton-table">
						${tableHeaderHtml}
						<tbody>
							${rowsHtml}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}


	build4LevelTree(data, metricCols) {
		const fmtNum = (val) => new Intl.NumberFormat("en-IN").format(Math.round(val || 0));
		const fmtAmt = (val) => {
			if (!val || val === 0) return "₹0";
			if (val >= 10000000) return "₹" + (val / 10000000).toFixed(2) + " Cr";
			if (val >= 100000) return "₹" + (val / 100000).toFixed(2) + " L";
			if (val >= 1000) return "₹" + (val / 1000).toFixed(2) + " K";
			return "₹" + new Intl.NumberFormat("en-IN").format(val);
		};

		if (!data || data.length === 0) return { rootNodes: [], grandTotal: {} };

		const rootNodes = [];
		const zMap = {};
		const grandTotal = {};

		metricCols.forEach(col => {
			grandTotal[col.key] = 0;
		});

		data.forEach(r => {
			const zName = (r.zone || "OTHER ZONE").trim();
			const rName = (r.region || "OTHER REGION").trim();
			const dName = (r.district || "OTHER DISTRICT").trim();
			const sCode = (r.sol_id || r.branch_code || "-").trim();
			const sName = (r.branch_name || r.sol_desc || r.branch || sCode).trim();
			const solLabel = sCode !== '-' ? `${sName} (${sCode})` : sName;

			if (!zMap[zName]) {
				zMap[zName] = {
					id: `z_${zName}`,
					name: zName,
					code: zName,
					type: "Zone",
					level: 1,
					children: {}
				};
				metricCols.forEach(col => zMap[zName][col.key] = 0);
				rootNodes.push(zMap[zName]);
			}

			const rMap = zMap[zName].children;
			if (!rMap[rName]) {
				rMap[rName] = {
					id: `r_${zName}_${rName}`,
					name: rName,
					code: rName,
					type: "Region",
					level: 2,
					children: {}
				};
				metricCols.forEach(col => rMap[rName][col.key] = 0);
			}

			const dMap = rMap[rName].children;
			if (!dMap[dName]) {
				dMap[dName] = {
					id: `d_${zName}_${rName}_${dName}`,
					name: dName,
					code: dName,
					type: "District",
					level: 3,
					children: {}
				};
				metricCols.forEach(col => dMap[dName][col.key] = 0);
			}

			const sMap = dMap[dName].children;
			if (!sMap[sCode]) {
				sMap[sCode] = {
					id: `s_${zName}_${rName}_${dName}_${sCode}`,
					name: solLabel,
					code: sCode,
					type: "SOL",
					level: 4,
					children: []
				};
				metricCols.forEach(col => sMap[sCode][col.key] = 0);
			}

			metricCols.forEach(col => {
				const val = col.calc ? col.calc(r) : (r[col.key] || 0);
				zMap[zName][col.key] += val;
				rMap[rName][col.key] += val;
				dMap[dName][col.key] += val;
				sMap[sCode][col.key] += val;
				grandTotal[col.key] += val;
			});
		});

		const sortKey = metricCols[metricCols.length - 1].key;
		rootNodes.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));

		return { rootNodes, grandTotal };
	}

	renderGeneric4LevelTreeTable(tableContainer, reportObj, data, metricCols, reportTitle) {
		const self = this;
		const fmtNum = (val) => new Intl.NumberFormat("en-IN").format(Math.round(val || 0));
		const fmtAmt = (val) => {
			if (!val || val === 0) return "₹0";
			if (val >= 10000000) return "₹" + (val / 10000000).toFixed(2) + " Cr";
			if (val >= 100000) return "₹" + (val / 100000).toFixed(2) + " L";
			if (val >= 1000) return "₹" + (val / 1000).toFixed(2) + " K";
			return "₹" + new Intl.NumberFormat("en-IN").format(val);
		};

		if (!data || data.length === 0) {
			tableContainer.html('<div style="padding: 30px; text-align: center; color: #64748b; font-weight: 600;">No data to display.</div>');
			return;
		}

		if (!reportObj.expandedTreeNodes) reportObj.expandedTreeNodes = {};

		const { rootNodes, grandTotal } = self.build4LevelTree(data, metricCols);

		const allNodeIds = [];
		const collectAllNodeIds = (nodes) => {
			nodes.forEach(n => {
				if (n.level < 4) {
					allNodeIds.push(n.id);
					let childList = Array.isArray(n.children) ? n.children : Object.values(n.children);
					collectAllNodeIds(childList);
				}
			});
		};
		collectAllNodeIds(rootNodes);

		const renderTreeRows = (nodes) => {
			let html = "";
			nodes.forEach(node => {
				const isExpanded = !!reportObj.expandedTreeNodes[node.id];
				const indent = (node.level - 1) * 10 + 10;
				const hasChildren = node.level < 4;

				let typeBadgeBg = "#e0f2fe";
				let typeBadgeColor = "#0369a1";
				let typeBadgeBorder = "#7dd3fc";
				if (node.level === 1) { typeBadgeBg = "#f3e8ff"; typeBadgeColor = "#7e22ce"; typeBadgeBorder = "#d8b4fe"; }
				else if (node.level === 2) { typeBadgeBg = "#e0e7ff"; typeBadgeColor = "#3730a3"; typeBadgeBorder = "#a5b4fc"; }
				else if (node.level === 3) { typeBadgeBg = "#fef3c7"; typeBadgeColor = "#92400e"; typeBadgeBorder = "#fcd34d"; }
				else if (node.level === 4) { typeBadgeBg = "#ccfbf1"; typeBadgeColor = "#115e59"; typeBadgeBorder = "#5eead4"; }

				let rowBg = '#ffffff';
				if (node.level === 1) rowBg = '#f8fafc';
				else if (node.level === 2) rowBg = '#ffffff';
				else if (node.level === 3) rowBg = '#f8fafc';
				else if (node.level === 4) rowBg = '#f0fdfa';

				html += `
					<tr class="generic-tree-row" data-node-id="${node.id}" data-level="${node.level}" style="cursor: pointer; background: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
						<td style="padding: 8px 12px; text-align: left; padding-left: ${indent}px; font-weight: ${node.level < 4 ? '700' : '600'}; color: #1e293b;">
							${hasChildren ? `<span class="tree-toggle-icon" style="display: inline-block; width: 16px; color: #417d81; font-weight: 800;">${isExpanded ? '▼' : '▶'}</span>` : '<span style="display: inline-block; width: 16px; color: #94a3b8;">•</span>'}
							<span style="color: ${node.level === 4 ? '#417d81' : '#0f172a'};">${node.name}</span>
						</td>
						<td style="padding: 8px 12px; text-align: left; font-size: 12px; font-weight: 700; color: #417d81;">${node.code}</td>
						<td style="padding: 8px 12px; text-align: left; font-size: 11px;">
							<span style="background: ${typeBadgeBg}; color: ${typeBadgeColor}; border: 1px solid ${typeBadgeBorder}; padding: 2px 8px; border-radius: 12px; font-weight: 700;">${node.type}</span>
						</td>
						${metricCols.map(col => {
							const val = node[col.key] || 0;
							const formatted = col.format === 'amt' ? fmtAmt(val) : fmtNum(val);
							const style = col.style || '';
							return `<td style="padding: 8px 12px; text-align: right; font-size: 12px; font-weight: 600; ${style}">${formatted}</td>`;
						}).join('')}
					</tr>
				`;

				if (hasChildren && isExpanded) {
					let childNodes = [];
					if (Array.isArray(node.children)) {
						childNodes = node.children;
					} else if (typeof node.children === "object") {
						childNodes = Object.values(node.children);
					}
					const sortKey = metricCols[metricCols.length - 1].key;
					childNodes.sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
					html += renderTreeRows(childNodes);
				}
			});
			return html;
		};

		const treeRowsHtml = renderTreeRows(rootNodes);

		const controlBarHtml = `
			<div class="rm-pagination-bar" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 8px; box-shadow: 0 1px 2px rgba(0,0,0,0.03);">
				<div style="font-size: 12px; font-weight: 700; color: #417d81; display: flex; align-items: center; gap: 8px;">
					<span>🌳 ${reportTitle} (Zone → Region → District → SOL)</span>
					<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700;">${fmtNum(data.length)} Branches Total</span>
				</div>
				<div style="display: flex; align-items: center; gap: 8px;">
					<button type="button" class="btn btn-xs generic-tree-expand-all" style="background: rgba(65, 125, 129, 0.1); color: #417d81; border: 1px solid rgba(65, 125, 129, 0.3); font-weight: 700; border-radius: 4px; padding: 4px 10px; cursor: pointer;">
						📂 Expand All
					</button>
					<button type="button" class="btn btn-xs generic-tree-collapse-all" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; font-weight: 700; border-radius: 4px; padding: 4px 10px; cursor: pointer;">
						📁 Collapse All
					</button>
				</div>
			</div>
		`;

		const tableHtml = `
			<style>
				.generic-tree-row { transition: background-color 0.15s ease-in-out; }
				.generic-tree-row:hover { background-color: #f0fdfa !important; }
			</style>
			${controlBarHtml}
			<div style="max-height: 650px; overflow-y: auto; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
				<table class="table table-sm table-hover" style="width: 100%; border-collapse: separate; border-spacing: 0; margin: 0; font-family: 'Inter', sans-serif;">
					<thead>
						<tr style="background: #417d81; color: #ffffff; position: sticky; top: 0; z-index: 2;">
							<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: left;">Z / R / D / SOL Name</th>
							<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: left;">Code / ID</th>
							<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: left;">Level</th>
							${metricCols.map(col => `<th style="padding: 10px 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; text-align: right;">${col.label}</th>`).join('')}
						</tr>
					</thead>
					<tbody>${treeRowsHtml}</tbody>
					<tfoot>
						<tr style="background: rgba(65, 125, 129, 0.08); color: #1e293b; font-weight: 700; position: sticky; bottom: 0; z-index: 2; border-top: 2px solid #417d81;">
							<td colspan="3" style="padding: 10px 12px; text-align: left; font-size: 12px; color: #417d81;">GRAND TOTAL (${fmtNum(data.length)} BRANCHES)</td>
							${metricCols.map(col => {
								const val = grandTotal[col.key] || 0;
								const formatted = col.format === 'amt' ? fmtAmt(val) : fmtNum(val);
								const style = col.style || '';
								return `<td style="padding: 10px 12px; text-align: right; font-size: 12px; font-weight: 800; ${style}">${formatted}</td>`;
							}).join('')}
						</tr>
					</tfoot>
				</table>
			</div>
		`;

		tableContainer.html(tableHtml).show();

		tableContainer.off("click", ".generic-tree-row").on("click", ".generic-tree-row", function () {
			const nodeId = $(this).data("node-id");
			const level = parseInt($(this).data("level"));
			if (level < 4) {
				reportObj.expandedTreeNodes[nodeId] = !reportObj.expandedTreeNodes[nodeId];
				self.renderGeneric4LevelTreeTable(tableContainer, reportObj, data, metricCols, reportTitle);
			}
		});

		tableContainer.off("click", ".generic-tree-expand-all").on("click", ".generic-tree-expand-all", function () {
			allNodeIds.forEach(id => reportObj.expandedTreeNodes[id] = true);
			self.renderGeneric4LevelTreeTable(tableContainer, reportObj, data, metricCols, reportTitle);
		});

		tableContainer.off("click", ".generic-tree-collapse-all").on("click", ".generic-tree-collapse-all", function () {
			reportObj.expandedTreeNodes = {};
			self.renderGeneric4LevelTreeTable(tableContainer, reportObj, data, metricCols, reportTitle);
		});
	}

	setupBranchProfilePopup() {
		if (!window.showBranchProfilePopup) {
			window.showBranchProfilePopup = (sol_id) => {
				let d = new frappe.ui.Dialog({
					title: "Branch Profile - " + sol_id,
					size: "extra-large",
					minimizable: true,
				});

				d.$body.html(`
					<div id="iframe-loader-${sol_id}" style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 85vh; width: 100%;">
						<div class="spinner-border text-primary" role="status" style="margin-bottom: 15px; width: 3rem; height: 3rem; animation: spinner-border .75s linear infinite;"></div>
						<h4 style="color: #475569; font-weight: 600;">Branch Profile is Loading...</h4>
						<p style="color: #64748b;">Please wait</p>
					</div>
					<iframe id="iframe-content-${sol_id}" src="/branch_profile?sol_id=${sol_id}" style="width: 100%; height: 85vh; border: none; border-radius: 4px; display: none;"></iframe>
				`);

				d.$body.find(`#iframe-content-${sol_id}`).on("load", function () {
					d.$body.find(`#iframe-loader-${sol_id}`).fadeOut(200, function () {
						d.$body.find(`#iframe-content-${sol_id}`).fadeIn(200);
					});
				});

				d.$wrapper.css({
					"backdrop-filter": "blur(5px)",
					"background-color": "rgba(15, 23, 42, 0.6)",
				});

				// Increase the width of the modal
				d.$wrapper.find(".modal-dialog").css({
					"max-width": "80vw",
					width: "80vw",
				});

				// Add Full Screen button before the close button
				const fullScreenBtn = $(
					'<button class="btn btn-default btn-xs" style="margin-right: 12px; font-weight: 500; border-radius: 4px;"><i class="fa fa-external-link"></i> Full Screen</button>',
				);
				fullScreenBtn.on("click", function () {
					window.location.href = "/branch_profile?sol_id=" + sol_id;
				});

				let actions = d.$wrapper.find(".modal-actions");
				if (actions.length > 0) {
					actions.prepend(fullScreenBtn);
				} else {
					// Fallback for older Frappe versions
					let closeBtn = d.$wrapper.find(
						".modal-header .btn-close, .modal-header .close",
					);
					if (closeBtn.length > 0) {
						closeBtn.before(fullScreenBtn);
					}
				}

				// Some extra styling for the dialog to look modern and hide the default padding
				d.$body.css({
					padding: "0",
					overflow: "hidden",
				});

				d.show();
			};
		}
	}

	initDatePicker() {
		const self = this;
		const container = $("#date-selector-container");
		if (container.length) {
			container.find(".frappe-control").remove();

			this.dateControl = frappe.ui.form.make_control({
				parent: container,
				df: {
					fieldtype: "Date",
					fieldname: "date_selector",
					placeholder: "DD/MM/YYYY",
					only_input: true,
					change: function () {
						if (self.isRefreshingDate) return;
						const val = self.dateControl.get_value();
						if (!val) return;

						const parts = val.split("-");
						const selected = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
						selected.setHours(0, 0, 0, 0);
						const today = new Date();
						today.setHours(0, 0, 0, 0);
						if (selected >= today) {
							frappe.show_alert({ message: "Today and future dates are not allowed.", indicator: "red" }, 3);
							const yesterday = new Date(today);
							yesterday.setDate(today.getDate() - 1);
							const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
							self.isRefreshingDate = true;
							self.dateControl.set_value(yStr);
							self.isRefreshingDate = false;
							return;
						}

						self.state.selectedDate = val;
						if (
							self.state.activeTab &&
							self.tabDates.hasOwnProperty(self.state.activeTab)
						) {
							self.tabDates[self.state.activeTab] = val;
						}

						// Automatically update financial year based on selected date
						const calculatedFy = self.getFinancialYearFromDate(val);
						if (calculatedFy) {
							const $fySelector = $("#fy-selector");
							if ($fySelector.length) {
								if (!$fySelector.find(`option[value="${calculatedFy}"]`).length) {
									$fySelector.prepend(
										`<option value="${calculatedFy}">${calculatedFy}</option>`,
									);
								}
								$fySelector.val(calculatedFy);
							}
							self.state.financialYear = calculatedFy;
						}

						// Automatically update selected quarter based on selected date
						self.state.selectedQuarter = self.getQuarterFromDate(val);

						// Automatically update selected month key based on selected date
						const monthNames = [
							"JAN",
							"FEB",
							"MAR",
							"APR",
							"MAY",
							"JUN",
							"JUL",
							"AUG",
							"SEP",
							"OCT",
							"NOV",
							"DEC",
						];
						const monthNum = parseInt(val.split("-")[1], 10); // 1-12
						self.state.selectedMonth = monthNames[monthNum - 1];

						self.updateUrlFromState();
						self._dataLoaded = false;
						self.loadData();
					},
				},
				render_input: true,
			});

			if (this.dateControl && this.dateControl.$input) {
				this.dateControl.$input.css({
					padding: "6px 10px",
					border: "1px solid #cbd5e1",
					"border-radius": "6px",
					background: "white",
					color: "#1b263b",
					"font-size": "13px",
					"font-weight": "600",
					height: "32px",
					width: "140px",
				});
				this.dateControl.$wrapper.css({
					margin: "0",
					padding: "0",
					display: "inline-block",
				});

				// Default date = yesterday
				const today = new Date();
				const yesterday = new Date(today);
				yesterday.setDate(today.getDate() - 1);
				const maxDateStr = frappe.datetime.obj_to_str(yesterday);

				if (!this.state.selectedDate) {
					this.state.selectedDate = maxDateStr;
					this.isRefreshingDate = true;
					this.dateControl.set_value(maxDateStr);
					this.isRefreshingDate = false;
				}
			}
		}
	}

	updateDatePickerValue(dateStr) {
		if (this.dateControl) {
			const currentVal = this.dateControl.get_value();
			if (currentVal === dateStr) return;

			this.isRefreshingDate = true;
			this.dateControl.set_value(dateStr || "");
			this.isRefreshingDate = false;
		}
	}

	loadFinancialYears() {
		const self = this;
		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_available_financial_years",
			callback: function (r) {
				if (r.message && r.message.length > 0) {
					self.financialYearsList = r.message;
					self.populateFinancialYears(r.message);
					// Select the latest (first) available year if not already set
					if (
						!self.state.financialYear ||
						!r.message.includes(self.state.financialYear)
					) {
						self.state.financialYear = r.message[0];
						$("#fy-selector").val(self.state.financialYear);
					}
					self.loadData();
					self._fyLoaded = true;
				}
			},
		});
	}

	populateFinancialYears(fyList) {
		const selector = $("#fy-selector");
		selector.empty();
		fyList.forEach(function (fy) {
			selector.append(`<option value="${fy}">${fy}</option>`);
		});
		selector.val(this.state.financialYear);
	}

	isPreviousFinancialYear() {
		if (!this.state.financialYear) return false;

		const fyStartYear = parseInt(this.state.financialYear.split("-")[0], 10);
		const today = frappe.datetime.str_to_obj(frappe.datetime.get_today());
		const currentFyStartYear =
			today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;

		return fyStartYear < currentFyStartYear;
	}

	getPreviousFinancialYearDefaultDate() {
		if (!this.isPreviousFinancialYear()) return null;

		const fyParts = this.state.financialYear.split("-");
		return `${fyParts[1]}-03-31`;
	}

	applyPreviousFinancialYearDefaultDate() {
		const defaultDate = this.getPreviousFinancialYearDefaultDate();
		if (!defaultDate) return;

		this.state.selectedDate = defaultDate;
		this.updateDatePickerValue(defaultDate);
		if (this.state.activeTab && this.tabDates.hasOwnProperty(this.state.activeTab)) {
			this.tabDates[this.state.activeTab] = defaultDate;
		}
	}

	getDashboardViewForRequest() {
		return this.state.viewType;
	}

	normalizeDashboardResponse(data) {
		if (!this.isPreviousFinancialYear()) return data;

		if (this.state.viewType === "Monthly") {
			const targetMonth = this.state.selectedMonth || "MAR";
			data.months = (data.months || []).filter((month) => month.key === targetMonth);
		}

		return data;
	}

	normalizeTargetType(targetType) {
		return ["Monthly", "YTD", "Yearly"].includes(targetType) ? targetType : "Monthly";
	}

	setupLegacyStyles() {
		// --- Font and Style Injection ---
		const fontLink = document.createElement("link");
		fontLink.href =
			"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
		fontLink.rel = "stylesheet";
		document.head.appendChild(fontLink);

		const style = `
            :root {
                --font-primary: 'Inter', sans-serif;
                --text-base: 14px;
                --line-height-base: 1.5;
            }
            .frappe-page .page-head, .frappe-page .page-content {
                font-family: var(--font-primary);
                font-size: var(--text-base);
                line-height: var(--line-height-base);
            }

            /* Section Titles (e.g., "DRISHTI") */
            .title-text {
                font-size: 18px !important;
                font-weight: 600 !important;
            }

            /* Sub-section Titles (e.g., "ZONE SELECTION") */
            .filter-section-label {
                font-size: 16px;
                font-weight: 500;
            }

            /* Top Filters / Pills */
            .filter-tag {
                font-size: 13px;
                font-weight: 500;
            }
            .filter-tag-count, .filter-tag-pct {
                font-size: 12px;
                font-weight: 600;
            }

            /* Table Headers */
            .table th {
                font-size: 13px;
                font-weight: 500;
                letter-spacing: 0.25px;
            }

            /* Table Body */
            .table td {
                font-size: 14px; /* Base for table body */
                font-weight: 400; /* Regular weight */
            }
            .table .zone-total-row > td:nth-child(2),
            .table .region-detail-row > td:nth-child(2) {
                font-weight: 600; /* Semibold for Zone/Region names */
            }
            .table td:first-child {
                font-size: 12px; /* Row index */
            }
            .table .amount-cell {
                font-weight: 500; /* Medium for Target/Achievement */
            }
            .pct-value { /* Class to be added to percentage span */
                font-size: 14px;
                font-weight: 600; /* Semibold for percentage values */
            }

            /* Total Row */
            tfoot tr td {
                font-size: 14px;
                font-weight: 700; /* Bold for label */
            }
            tfoot tr td:not(:first-child) {
                font-size: 15px;
                font-weight: 600; /* Semibold for numbers */
            }

            /* Meta / Status Text */
            .table th.month-col {
                font-size: 14px;
                font-weight: 500; /* Medium */
            }
            .days-left-indicator {
                font-size: 12px;
                font-weight: 400; /* Regular */
            }

			.movement-popup .popup-main-container {
				max-height: 400px; /* Default max-height */
				overflow-y: auto;
			}

			@keyframes viewControlBlink {
				0%, 100% {
					box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
					background: transparent;
				}
				50% {
					box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.35);
					background: rgba(245, 158, 11, 0.12);
				}
			}

			.view-change-highlight {
				border-radius: 6px;
				animation: viewControlBlink 1s ease-in-out 4;
			}

			@keyframes quarterlyLinkBlink {
				0%, 100% {
					color: #b45309;
					background: rgba(245, 158, 11, 0.12);
					box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
					transform: scale(1);
				}
				50% {
					color: #92400e;
					background: rgba(245, 158, 11, 0.28);
					box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.2);
					transform: scale(1.04);
				}
			}

			.quarterly-view-link {
				color: #b45309;
				font-weight: 700;
				text-decoration: underline;
				text-underline-offset: 2px;
				padding: 2px 8px;
				border-radius: 4px;
				background: rgba(245, 158, 11, 0.12);
				animation: quarterlyLinkBlink 1s ease-in-out infinite;
			}

			.view-change-panel {
				position: relative;
				margin-top: 12px;
				padding: 14px;
				border: 1px solid rgba(245, 158, 11, 0.45);
				border-radius: 12px;
				background: linear-gradient(135deg, #fffaf0 0%, #ffefc7 100%);
				box-shadow:
					0 10px 24px rgba(15, 23, 42, 0.12),
					inset 0 1px 0 rgba(255, 255, 255, 0.7);
				overflow: hidden;
			}

			.view-change-panel::before {
				content: "";
				position: absolute;
				inset: 0;
				background:
					linear-gradient(90deg, rgba(255, 255, 255, 0.18) 0, rgba(255, 255, 255, 0) 35%),
					repeating-linear-gradient(
						135deg,
						rgba(180, 83, 9, 0.06) 0,
						rgba(180, 83, 9, 0.06) 10px,
						transparent 10px,
						transparent 20px
					);
				pointer-events: none;
			}

			.view-change-panel-title {
				position: relative;
				font-size: 11px;
				font-weight: 700;
				color: #92400e;
				margin-bottom: 10px;
				letter-spacing: 0.9px;
				text-transform: uppercase;
			}

			.view-change-panel-body {
				position: relative;
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 14px;
				flex-wrap: wrap;
			}

			.view-change-panel-copy {
				min-width: 180px;
				flex: 1 1 220px;
			}

			.view-change-panel-headline {
				color: #7c2d12;
				font-size: 18px;
				font-weight: 800;
				line-height: 1.1;
				margin-bottom: 4px;
				text-shadow: 0 1px 0 rgba(255, 255, 255, 0.7);
			}

			.view-change-panel-subtext {
				color: #9a3412;
				font-size: 12px;
				font-weight: 600;
			}

			.view-change-options {
				position: relative;
				display: flex;
				gap: 8px;
				flex-wrap: wrap;
			}

			.view-change-option {
				display: inline-flex;
				align-items: center;
				justify-content: center;
				padding: 9px 14px;
				border-radius: 10px;
				border: 1px solid #cbd5e1;
				background: linear-gradient(180deg, #ffffff 0%, #edf2f7 100%);
				color: #1b263b;
				font-weight: 600;
				text-decoration: none;
				box-shadow:
					inset 0 1px 0 rgba(255, 255, 255, 0.8),
					0 4px 0 rgba(148, 163, 184, 0.45),
					0 8px 18px rgba(15, 23, 42, 0.12);
				transform: translateY(0);
				transition:
					transform 0.12s ease,
					box-shadow 0.12s ease,
					background 0.12s ease;
			}

			.view-change-option:hover {
				text-decoration: none;
				color: #0d1b2a;
				transform: translateY(-1px);
				box-shadow:
					inset 0 1px 0 rgba(255, 255, 255, 0.85),
					0 5px 0 rgba(148, 163, 184, 0.45),
					0 10px 20px rgba(15, 23, 42, 0.16);
			}

			.view-change-option.is-recommended {
				color: #7c2d12;
				border-color: rgba(245, 158, 11, 0.45);
				background: linear-gradient(180deg, #ffe6a7 0%, #fbbf24 100%);
				box-shadow:
					inset 0 1px 0 rgba(255, 255, 255, 0.65),
					0 5px 0 rgba(180, 83, 9, 0.45),
					0 10px 24px rgba(245, 158, 11, 0.24);
				animation: quarterlyLinkBlink 1s ease-in-out infinite;
			}

			/* Product Wise Table - Column Layout */
			.product-wise-table th, .gl-wise-table th {
				text-align: center;
				vertical-align: middle;
				background: #f8f9fa;
				position: sticky;
				top: 0;
				z-index: 2;
			}
			.product-wise-table thead, .gl-wise-table thead {
				position: sticky;
				top: 0;
				z-index: 2;
			}
			.product-wise-table td, .gl-wise-table td {
				text-align: right;
				vertical-align: middle;
			}
			.product-wise-table td:nth-child(2), .gl-wise-table td:nth-child(2) {
				text-align: left !important;
			}

			.sahayog-dashboard-full-width .container {
				max-width: 95% !important;
				width: 95% !important;
				padding-left: 0px !important;
				padding-right: 0px !important;
				margin: 0px auto !important;
			}
			.sahayog-dashboard-full-width .container .page-body {
				max-width: 100% !important;
				width: 100% !important;
				padding: 0px !important;
				margin: 0px !important;
			}

			/* Sticky columns for Zone table and Branch table */
			.zone-wise-table .sr-col,
			.zone-wise-table .zone-col,
			.zone-wise-table .branches-col {
				position: sticky;
				background-color: #ffffff;
				background-clip: border-box !important;
				box-sizing: border-box !important;
				border-right: none !important;
			}
			.zone-wise-table th.sr-col,
			.zone-wise-table th.zone-col,
			.zone-wise-table th.branches-col {
				z-index: 6;
				background: linear-gradient(180deg, #3d7579 0%, #346569 100%) !important;
				color: #ffffff !important;
				border-right: none !important;
			}
			.zone-wise-table th.sr-col {
				box-shadow: inset -1px 0 0 #366b6f !important;
			}
			.zone-wise-table th.zone-col {
				box-shadow: inset -1px 0 0 #366b6f !important;
			}
			.zone-wise-table th.branches-col {
				box-shadow: inset -2px 0 0 #2d5659 !important;
			}
			.zone-wise-table td.sr-col,
			.zone-wise-table td.zone-col,
			.zone-wise-table td.branches-col {
				z-index: 5;
				border-right: none !important;
			}
			.zone-wise-table td.sr-col {
				box-shadow: inset -1px 0 0 #cbd5e1 !important;
			}
			.zone-wise-table td.zone-col {
				box-shadow: inset -1px 0 0 #cbd5e1 !important;
			}
			.zone-wise-table td.branches-col {
				box-shadow: inset -2px 0 0 #3d7579 !important;
			}
			.zone-wise-table .sr-col {
				left: 0px;
				width: 50px;
				min-width: 50px;
				max-width: 50px;
			}
			.zone-wise-table .zone-col {
				left: 50px;
				width: 180px;
				min-width: 180px;
				max-width: 180px;
				text-align: left !important;
				white-space: normal !important;
			}
			.zone-wise-table .branches-col {
				left: 230px;
				width: 100px;
				min-width: 100px;
				max-width: 100px;
				white-space: normal !important;
			}
			.zone-wise-table tr:hover td.sr-col,
			.zone-wise-table tr:hover td.zone-col,
			.zone-wise-table tr:hover td.branches-col {
				background-color: #f8f9fa !important;
			}
			.region-detail-row td.sr-col {
				border-left: 4px solid #417d81 !important;
			}

			.branch-table td.sr-col,
			.branch-table td.branch-col,
			.branch-table td.segment-col {
				position: sticky;
				background-color: #ffffff;
				background-clip: border-box !important;
				box-sizing: border-box !important;
				border-right: none !important;
			}
			.branch-table th.sr-col,
			.branch-table th.branch-col,
			.branch-table th.segment-col {
				position: sticky;
				z-index: 6;
				background: linear-gradient(180deg, #3d7579 0%, #346569 100%) !important;
				color: #ffffff !important;
				box-sizing: border-box !important;
				border-right: none !important;
			}
			.branch-table th.sr-col {
				box-shadow: inset -1px 0 0 #366b6f !important;
			}
			.branch-table th.branch-col {
				box-shadow: inset -1px 0 0 #366b6f !important;
			}
			.branch-table th.segment-col {
				box-shadow: inset -2px 0 0 #2d5659 !important;
			}
			.branch-table td.sr-col,
			.branch-table td.branch-col,
			.branch-table td.segment-col {
				z-index: 5;
				border-right: none !important;
			}
			.branch-table td.sr-col {
				box-shadow: inset -1px 0 0 #cbd5e1 !important;
			}
			.branch-table td.branch-col {
				box-shadow: inset -1px 0 0 #cbd5e1 !important;
			}
			.branch-table td.segment-col {
				box-shadow: inset -2px 0 0 #3d7579 !important;
			}
			.branch-table .sr-col {
				left: 0px;
				width: 60px;
				min-width: 60px;
				max-width: 60px;
			}
			.branch-table .branch-col {
				left: 60px;
				width: 145px;
				min-width: 145px;
				max-width: 145px;
				white-space: normal !important;
			}
			.branch-table .segment-col {
				left: 205px;
				width: 80px;
				min-width: 80px;
				max-width: 80px;
				white-space: normal !important;
			}
			.branch-table-row {
				background-color: #ffffff;
			}

			.zone-wise-table, .branch-table {
				width: max-content !important;
				min-width: 100% !important;
			}

			.zone-wise-table th,
			.zone-wise-table td,
			.branch-table th,
			.branch-table td {
				white-space: nowrap;
			}

			.zone-wise-table th,
			.branch-table th,
			.agent-wise-table th,
			.product-wise-table th,
			.gl-wise-table th,
			.category-table-redesigned th {
				text-align: center !important;
				vertical-align: middle !important;
			}
		`;
		$(`<style>${style}</style>`).appendTo("head");
	}

	getQuarterFromDate(dateStr) {
		const date = new Date(dateStr || frappe.datetime.get_today());
		const month = date.getMonth(); // 0-indexed
		if (month >= 3 && month <= 5) return "Q1";
		if (month >= 6 && month <= 8) return "Q2";
		if (month >= 9 && month <= 11) return "Q3";
		return "Q4";
	}

	getFinancialYearFromDate(dateStr) {
		if (!dateStr) return null;
		const parts = dateStr.split("-");
		const year = parseInt(parts[0], 10);
		const month = parseInt(parts[1], 10); // 1-12

		let startYear;
		if (month >= 4) {
			startYear = year;
		} else {
			startYear = year - 1;
		}
		const endYear = startYear + 1;
		return `${startYear}-${endYear}`;
	}

	getQuarterDate(quarter, fy) {
		if (!fy) return frappe.datetime.get_today();
		const startYear = fy.split("-")[0];
		const endYear = fy.split("-")[1]
			? ("20" + fy.split("-")[1]).replace("2020", "20")
			: (parseInt(startYear) + 1).toString();
		const endYearFull = endYear.length === 2 ? "20" + endYear : endYear;
		switch (quarter) {
			case "Q1":
				return `${startYear}-06-30`;
			case "Q2":
				return `${startYear}-09-30`;
			case "Q3":
				return `${startYear}-12-31`;
			case "Q4":
				return `${endYearFull}-03-31`;
			default:
				return frappe.datetime.get_today();
		}
	}

	processNewApiResponse() {
		const data = this.data;

		// Extract months
		this.months = data.months.map((m) => ({
			key: m.key,
			display: m.display,
			date: m.date,
		}));

		if (this.state.viewType === "Quarterly") {
			const startYear = this.state.financialYear
				? this.state.financialYear.split("-")[0]
				: new Date().getFullYear().toString();
			let endYear = this.state.financialYear
				? this.state.financialYear.split("-")[1]
				: (parseInt(startYear) + 1).toString();
			if (endYear && endYear.length === 2) endYear = "20" + endYear;

			const qMap = {
				Q1: [
					{
						key: "APR",
						display: `APR-${startYear.slice(-2)}`,
						date: `${startYear}-04-01`,
					},
					{
						key: "MAY",
						display: `MAY-${startYear.slice(-2)}`,
						date: `${startYear}-05-01`,
					},
					{
						key: "JUN",
						display: `JUN-${startYear.slice(-2)}`,
						date: `${startYear}-06-01`,
					},
				],
				Q2: [
					{
						key: "JUL",
						display: `JUL-${startYear.slice(-2)}`,
						date: `${startYear}-07-01`,
					},
					{
						key: "AUG",
						display: `AUG-${startYear.slice(-2)}`,
						date: `${startYear}-08-01`,
					},
					{
						key: "SEP",
						display: `SEP-${startYear.slice(-2)}`,
						date: `${startYear}-09-01`,
					},
				],
				Q3: [
					{
						key: "OCT",
						display: `OCT-${startYear.slice(-2)}`,
						date: `${startYear}-10-01`,
					},
					{
						key: "NOV",
						display: `NOV-${startYear.slice(-2)}`,
						date: `${startYear}-11-01`,
					},
					{
						key: "DEC",
						display: `DEC-${startYear.slice(-2)}`,
						date: `${startYear}-12-01`,
					},
				],
				Q4: [
					{ key: "JAN", display: `JAN-${endYear.slice(-2)}`, date: `${endYear}-01-01` },
					{ key: "FEB", display: `FEB-${endYear.slice(-2)}`, date: `${endYear}-02-01` },
					{ key: "MAR", display: `MAR-${endYear.slice(-2)}`, date: `${endYear}-03-01` },
				],
			};
			const quarter =
				this.state.selectedQuarter ||
				this.getQuarterFromDate(this.state.selectedDate || frappe.datetime.get_today());
			this.months = qMap[quarter] || this.months;
		}

		// Direct mapping
		this.zoneData = data.zone_wise;
		this.productData = data.product_wise || [];
		this.allProducts = data.all_products || [];
		this.categoryData = data.category_wise;
		this.branchData = data.branch_wise;
		this.agentData = data.agent_wise || [];

		// Extract zones from zone_wise data
		const zonesSet = new Set();
		this.zoneData.forEach((item) => {
			if (item.zone === item.region) {
				zonesSet.add(item.zone);
			}
		});

		this.availableFilters.zones = Array.from(zonesSet).sort((a, b) => {
			const aNum = a.match(/ZONE-(\d+)/)?.[1];
			const bNum = b.match(/ZONE-(\d+)/)?.[1];
			return aNum && bNum ? parseInt(aNum) - parseInt(bNum) : a.localeCompare(b);
		});

		// Category counts from first month
		const firstMonth = this.months[0]?.key;
		if (firstMonth) {
			this.categoryCounts = {};
			this.categoryData.forEach((cat) => {
				this.categoryCounts[cat.category] = cat.months[firstMonth]?.count || 0;
			});
			this.categoryCounts.all = this.branchData.length;
		}

		// Zone counts
		this.zoneCounts = {};
		this.availableFilters.zones.forEach((zone) => {
			this.zoneCounts[zone] = this.branchData.filter((b) => b.zone === zone).length;
		});
		this.zoneCounts.all = this.branchData.length;

		// Update region options
		this.updateRegionOptions();

		// Extract districts
		const districtSet = new Set();
		this.zoneData.forEach((item) => {
			if (item.district && item.district !== item.zone && item.district !== item.region && !item.isZoneTotal && !item.isRegionTotal) {
				districtSet.add(item.district);
			}
		});
		this.availableFilters.districts = Array.from(districtSet).sort();
		this.updateDistrictOptions();
	}

	// ========================================================================
	// URL STATE MANAGEMENT
	// ========================================================================

	updateStateFromUrl() {
		const urlParams = new URLSearchParams(window.location.search);
		const queryParams = {};
		for (const [key, value] of urlParams.entries()) {
			queryParams[key] = value;
		}

		if (Object.keys(queryParams).length > 0) {
			this.state.financialYear = queryParams.financialYear || this.state.financialYear;
			this.state.activeTab = queryParams.activeTab || this.state.activeTab;
			this.state.viewType = queryParams.viewType || this.state.viewType;
			this.state.targetType = this.normalizeTargetType(
				queryParams.targetType || this.state.targetType,
			);
			this.state.formatMode = queryParams.formatMode || this.state.formatMode;
			this.state.selectedDate = queryParams.selectedDate || this.state.selectedDate;
			this.state.branchSearchTerm =
				queryParams.branchSearchTerm || this.state.branchSearchTerm;
			this.state.selectedMonth = queryParams.selectedMonth || this.state.selectedMonth;
			this.state.selectedSegment = queryParams.selectedSegment || this.state.selectedSegment;
			this.state.selectedQuarter = queryParams.selectedQuarter || this.state.selectedQuarter;
			this.state.dashboardMode = queryParams.dashboardMode || this.state.dashboardMode;
			this.state.selectedMisReport = queryParams.selectedMisReport || this.state.selectedMisReport;

			if (queryParams.selectedRegions) {
				this.state.selectedRegions = queryParams.selectedRegions
					.split(",")
					.filter(Boolean);
			} else if (queryParams.selectedRegion) {
				this.state.selectedRegions = [queryParams.selectedRegion];
			} else {
				this.state.selectedRegions = [];
			}

			if (queryParams.selectedDistricts) {
				this.state.selectedDistricts = queryParams.selectedDistricts
					.split(",")
					.filter(Boolean);
			} else {
				this.state.selectedDistricts = [];
			}

			if (queryParams.selectedCategories) {
				this.state.selectedCategories = queryParams.selectedCategories
					.split(",")
					.filter(Boolean);
			}
			if (queryParams.selectedZones) {
				this.state.selectedZones = queryParams.selectedZones.split(",").filter(Boolean);
			}
		}
	}

	updateUrlFromState() {
		const newUrl = new URL(window.location);
		const newSearchParams = new URLSearchParams();

		const stateToParams = {
			financialYear: this.state.financialYear,
			activeTab: this.state.activeTab,
			viewType: this.state.viewType,
			targetType: this.state.targetType,
			formatMode: this.state.formatMode,
			selectedDate: this.state.selectedDate,
			selectedQuarter: this.state.selectedQuarter,
			branchSearchTerm: this.state.branchSearchTerm,
			selectedMonth: this.state.selectedMonth,
			selectedSegment: this.state.selectedSegment,
			dashboardMode: this.state.dashboardMode,
			selectedMisReport: this.state.selectedMisReport,
		};

		// Add non-empty simple string/number parameters
		for (const key in stateToParams) {
			const value = stateToParams[key];
			if (value !== null && value !== undefined && value !== "" && value !== "all") {
				newSearchParams.set(key, value);
			}
		}

		// Handle array parameters
		if (this.state.selectedCategories.length > 0) {
			newSearchParams.set("selectedCategories", this.state.selectedCategories.join(","));
		}
		if (this.state.selectedZones.length > 0) {
			newSearchParams.set("selectedZones", this.state.selectedZones.join(","));
		}
		if (this.state.selectedRegions.length > 0) {
			newSearchParams.set("selectedRegions", this.state.selectedRegions.join(","));
		}
		if (this.state.selectedDistricts.length > 0) {
			newSearchParams.set("selectedDistricts", this.state.selectedDistricts.join(","));
		}

		newUrl.search = newSearchParams.toString();
		history.pushState({}, "", newUrl.toString());
	}

	updateUiFromState() {
		// Update FY selector
		$("#fy-selector").val(this.state.financialYear);

		// Update View toggle
		this.page.main.find(".view-toggle-btn").removeClass("active");
		this.page.main
			.find(`.view-toggle-btn[data-view="${this.state.viewType}"]`)
			.addClass("active");

		// Update Quarter toggle
		if (this.state.viewType === "Quarterly") {
			this.page.main.find("#quarter-selector-container").show();
			this.page.main.find(".quarter-toggle-btn").removeClass("active");
			if (!this.state.selectedQuarter) {
				this.state.selectedQuarter = this.getQuarterFromDate(
					this.state.selectedDate || frappe.datetime.get_today(),
				);
				this.state.selectedDate = this.getQuarterDate(
					this.state.selectedQuarter,
					this.state.financialYear,
				);
			}
			this.page.main
				.find(`.quarter-toggle-btn[data-quarter="${this.state.selectedQuarter}"]`)
				.addClass("active");
		} else {
			this.page.main.find("#quarter-selector-container").hide();
		}

		// Update Month selector
		if (this.state.viewType === "Monthly") {
			this.page.main.find("#month-selector-container").show();
			const dateToUse = this.state.selectedDate || frappe.datetime.get_today();
			const monthVal = parseInt(dateToUse.split("-")[1], 10); // 1-12
			this.page.main.find("#month-selector").val(monthVal);
		} else {
			this.page.main.find("#month-selector-container").hide();
		}

		// Update Target toggle
		this.page.main.find(".target-toggle-btn").removeClass("active");
		this.page.main
			.find(`.target-toggle-btn[data-target="${this.state.targetType}"]`)
			.addClass("active");

		// Update Format toggle
		$(".format-toggle-btn").removeClass("active");
		$(`.format-toggle-btn[data-format="${this.state.formatMode}"]`).addClass("active");

		// Update Date selector
		this.updateDatePickerValue(this.state.selectedDate);

		// Update Region selector
		this.updateRegionDropdownUI();

		// Update District selector
		this.updateDistrictDropdownUI();

		// Update Branch search
		this.page.main.find("#branch-search").val(this.state.branchSearchTerm);

		// Update Segment filter
		this.page.main.find("#segment-filter").val(this.state.selectedSegment);

		// Update tabs
		this.page.main.find(".tab-btn").removeClass("active");
		this.page.main.find(`.tab-btn[data-tab="${this.state.activeTab}"]`).addClass("active");

		// Update dashboard mode toggle
		const header = $(this.page.wrapper || ".frappe-page:visible").find(".page-head-row").length
			? $(this.page.wrapper || ".frappe-page:visible").find(".page-head-row")
			: $(this.page.wrapper || ".frappe-page:visible").find(".page-head .container");
		if (header.length) {
			header.find(".dashboard-toggle-btn").removeClass("active");
			header.find(`.dashboard-toggle-btn[data-value="${this.state.dashboardMode}"]`).addClass("active");
		}

		// Update filter tags for zones and categories
		this.updateFilterTagsUI();
		this.applyBranchManagerRestrictions();
	}

	repopulateHeaderFilters() {
		if (this.financialYearsList && this.financialYearsList.length > 0) {
			this.populateFinancialYears(this.financialYearsList);
		}
		this.updateUiFromState();
	}

	// ========================================================================
	// MIS DASHBOARD MODE
	// ========================================================================

	setupHeaderToggle() {
		const self = this;
		const header = $(this.page.wrapper || ".frappe-page:visible").find(".page-head-row").length
			? $(this.page.wrapper || ".frappe-page:visible").find(".page-head-row")
			: $(this.page.wrapper || ".frappe-page:visible").find(".page-head .container");

		if (!header.length) return;

		header.css("position", "relative");
		header.find(".dashboard-header-toggle-wrapper").remove();

		const toggleHtml = `
			<div class="dashboard-header-toggle-wrapper">
				<div class="dashboard-toggle-switch-container">
					<button type="button" class="dashboard-toggle-btn ${self.state.dashboardMode === 'drishti' ? 'active' : ''}" data-value="drishti">Drishti</button>
					<button type="button" class="dashboard-toggle-btn ${self.state.dashboardMode === 'mis' ? 'active' : ''}" data-value="mis">MIS Reports</button>
				</div>
			</div>
		`;

		header.append(toggleHtml);

		header.off("click", ".dashboard-toggle-btn").on("click", ".dashboard-toggle-btn", function () {
			const val = $(this).data("value");
			header.find(".dashboard-toggle-btn").removeClass("active");
			$(this).addClass("active");
			self.switchDashboardMode(val);
			self.updateUrlFromState();
		});
	}

	switchDashboardMode(mode) {
		this.state.dashboardMode = mode;
		if (mode === "drishti") {
			if (this.mis_container) this.mis_container.hide();
			if (this.drishti_container) this.drishti_container.show();
			$(this.page.wrapper).find("#drishti-subtitle").show();
			$("#drishti-header-timer").show();
			if (this._fyLoaded) { this._dataLoaded = false; this.loadData(); }
		} else {
			if (this.drishti_container) this.drishti_container.hide();
			if (this.mis_container) {
				this.mis_container.show();
				const activeReportId = this.state.selectedMisReport || (this.misReportsList.length > 0 ? this.misReportsList[0].id : "");
				this.mis_container.find(".mis-report-tab-btn").removeClass("active");
				this.mis_container.find(".mis-dropdown-toggle").removeClass("active");
				const $matchedTab = this.mis_container.find(`.mis-report-tab-btn[data-report-id="${activeReportId}"]`);
				if ($matchedTab.length) {
					$matchedTab.addClass("active");
				} else {
					const $dropdown = this.mis_container.find(".mis-report-dropdown");
					if ($dropdown.length) {
						const childIds = ($dropdown.data("child-ids") || "").split(",");
						if (childIds.includes(activeReportId)) {
							$dropdown.find(".mis-dropdown-toggle").addClass("active").attr("data-selected-child", activeReportId);
							$dropdown.find(".mis-dropdown-item.active").removeClass("active");
							$dropdown.find(`.mis-dropdown-item[data-report-id="${activeReportId}"]`).addClass("active");
						}
					}
				}
				this.renderMisReport(activeReportId);
			} else {
				this.initMisReportsContainer();
				const activeReportId = this.state.selectedMisReport || (this.misReportsList.length > 0 ? this.misReportsList[0].id : "");
				this.renderMisReport(activeReportId);
			}
			$(this.page.wrapper).find("#drishti-subtitle").hide();
			$("#drishti-header-timer").hide();
		}
	}

	initMisReportsContainer() {
		this.mis_container = $('<div id="mis-reports-container" style="border: 1px solid #cbd5e1; padding: 16px; background: #fff; border-radius: 8px; margin-top: 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);"></div>').appendTo(this.page.main);

		const selectorHtml = `
			<div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #cbd5e1; padding-bottom: 8px; margin-bottom: 16px; width: 100%;">
				<div style="display: flex; gap: 12px;" id="mis-report-selector-tabs"></div>
			</div>
			<div id="mis-report-title" style="font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 12px; padding: 0 4px;"></div>
			<div id="mis-report-content-area" style="min-height: 200px;"></div>
		`;
		this.mis_container.html(selectorHtml);

		const self = this;
		const tabSelectorContainer = this.mis_container.find("#mis-report-selector-tabs");
		const activeReportId = this.state.selectedMisReport || (this.misReportsList.length > 0 ? this.misReportsList[0].id : "");

		this.misReportsList.forEach((report) => {
			if (report.type === "group") {
				const firstChildId = report.children[0];
				const selectedChildId = report.children.includes(activeReportId) ? activeReportId : firstChildId;
				const selectedChild = this.misReportsList.find(r => r.id === selectedChildId);
				const isActive = report.children.includes(activeReportId);
				const childIds = report.children.join(",");

				tabSelectorContainer.append(`
					<div class="mis-report-dropdown" data-child-ids="${childIds}" style="position: relative; display: inline-block;">
						<button class="mis-report-tab-btn mis-dropdown-toggle ${isActive ? "active" : ""}" data-selected-child="${selectedChildId}" style="display: inline-flex; align-items: center; gap: 4px;">
							${report.name} <span style="font-size: 10px; margin-left: 2px;">▾</span>
						</button>
						<div class="mis-dropdown-menu" style="display: none; position: absolute; top: 100%; left: 0; min-width: 280px; background: #fff; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 100; padding: 4px; margin-top: 4px;">
							${report.children.map(childId => {
								const child = self.misReportsList.find(r => r.id === childId);
								return `<button class="mis-dropdown-item ${childId === activeReportId ? "active" : ""}" data-report-id="${childId}">${child.name}</button>`;
							}).join("")}
						</div>
					</div>
				`);
			} else {
				const isChildOfGroup = this.misReportsList.some(r => r.type === "group" && r.children && r.children.includes(report.id));
				if (isChildOfGroup) return;
				const activeClass = report.id === activeReportId ? "active" : "";
				tabSelectorContainer.append(`
					<button class="mis-report-tab-btn ${activeClass}" data-report-id="${report.id}">
						${report.name}
					</button>
				`);
			}
		});

		this.mis_container.on("click", ".mis-report-tab-btn:not(.mis-dropdown-toggle)", function () {
			self.mis_container.find(".mis-report-tab-btn.active, .mis-dropdown-toggle.active, .mis-dropdown-item.active").removeClass("active");
			$(this).addClass("active");
			const reportId = $(this).data("report-id");
			self.state.selectedMisReport = reportId;
			self.updateUrlFromState();
			self.renderMisReport(reportId);
		});

		this.mis_container.on("click", ".mis-dropdown-toggle", function (e) {
			e.stopPropagation();
			const $menu = $(this).siblings(".mis-dropdown-menu");
			$(".mis-dropdown-menu").not($menu).hide();
			$menu.toggle();
		});

		this.mis_container.on("click", ".mis-dropdown-item", function () {
			const reportId = $(this).data("report-id");
			const $dropdown = $(this).closest(".mis-report-dropdown");
			self.mis_container.find(".mis-dropdown-item.active").removeClass("active");
			$(this).addClass("active");
			$dropdown.find(".mis-dropdown-toggle").attr("data-selected-child", reportId);
			$dropdown.find(".mis-dropdown-menu").hide();
			self.mis_container.find(".mis-report-tab-btn.active, .mis-dropdown-toggle.active").removeClass("active");
			$dropdown.find(".mis-dropdown-toggle").addClass("active");
			self.state.selectedMisReport = reportId;
			self.updateUrlFromState();
			self.renderMisReport(reportId);
		});

		$(document).on("click", function () {
			$(".mis-dropdown-menu").hide();
		});

		const contentArea = this.mis_container.find("#mis-report-content-area");
		contentArea.html('<div style="padding: 40px; text-align: center; color: #64748b; font-weight: 600; font-family: \'Inter\', sans-serif;">Click a report tab above to load data.</div>');
	}

	renderMisReport(reportId) {
		this._misRenderSeq = (this._misRenderSeq || 0) + 1;
		const seq = this._misRenderSeq;
		const report = this.misReportsList.find(r => r.id === reportId);
		const contentArea = this.mis_container.find("#mis-report-content-area");
		const titleEl = this.mis_container.find("#mis-report-title");
		if (report && contentArea.length) {
			if (report.loadedUser && report.loadedUser !== frappe.session.user) {
				report.tableData = [];
				report.filterOptions = null;
				report.loadedUser = null;
			}
			titleEl.text(report.name);
			if (typeof report.render === "function") {
				report.render(contentArea, this, seq);
			} else {
				contentArea.html('<p style="color: #64748b; padding: 20px;">No custom renderer provided for this report.</p>');
			}
		}
	}

	// ========================================================================
	// CONTROLS - View, Target, FY, Date, Region, Branch, Format
	// ========================================================================
	createControls() {
		// All controls have been moved to createTabsAndContainer
	}

	clearAllFilters() {
		this.state.selectedDate = null;
		this.state.selectedCategories = [];
		this.state.selectedZones = [];
		this.state.selectedRegions = [];
		this.state.selectedDistricts = [];
		this.state.branchSearchTerm = "";
		this.state.selectedMonth = null;
		this.state.drillDownActive = false;

		this.updateDatePickerValue("");
		this.updateRegionDropdownUI();
		this.page.main.find("#branch-search").val("");

		this.updateFilterCounts();
		this.updateFilterTagsUI();
		this.updateUrlFromState();
		this.loadData();
	}

	toggleFormat() {
		this.state.formatMode = this.state.formatMode === "number" ? "words" : "number";

		const btn = this.page.main.find("#format-toggle");
		if (this.state.formatMode === "words") {
			btn.text("Show in Numbers");
		} else {
			btn.text("Show in Words");
		}

		this.render();
	}

	// ========================================================================
	// FILTER TAGS - Zone & Category Selection
	// ========================================================================
	createFilterTags() {
		const html = `
            <div id="summary-cards-container" class="summary-cards-container">
                <div class="summary-card">
                    <div class="summary-info">
                        <span class="summary-label">Total Branches</span>
                        <span class="summary-value" id="summary-total-branches">229</span>
                        <span class="summary-subtext success" id="summary-branches-trend">+12% from last month</span>
                    </div>
                    <div class="summary-icon-box">
                        <i class="fa fa-building"></i>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="summary-info">
                        <span class="summary-label">Target Amount</span>
                        <span class="summary-value" id="summary-target-amount">₹163.04 Cr</span>
                        <span class="summary-subtext success" id="summary-target-label">Monthly target</span>
                    </div>
                    <div class="summary-icon-box">
                        <i class="fa fa-bullseye"></i>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="summary-info">
                        <span class="summary-label">Achievement</span>
                        <span class="summary-value" id="summary-achievement-amount">₹91.45 Cr</span>
                        <span class="summary-subtext danger" id="summary-achievement-pct">57.9% achieved</span>
                    </div>
                    <div class="summary-icon-box">
                        <i class="fa fa-line-chart"></i>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="summary-info">
                        <span class="summary-label">Ach Gap</span>
                        <span class="summary-value" id="summary-gap-amount">₹0</span>
                        <span class="summary-subtext danger" id="summary-gap-subtext">0% gap</span>
                    </div>
                    <div class="summary-icon-box">
                        <i class="fa fa-hourglass-half"></i>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="summary-info">
                        <span class="summary-label">Active Zones</span>
                        <span class="summary-value" id="summary-active-zones">6 Zones</span>
                        <span class="summary-subtext success">All zones operational</span>
                    </div>
                    <div class="summary-icon-box">
                        <i class="fa fa-users"></i>
                    </div>
                </div>
            </div>
            <div class="filter-tags-row">
                <!-- Zone Selection -->
                <div class="filter-tags-container zone-filter-container">
                    <div class="filter-group">
                        <span class="filter-group-label">Zone:</span>
                        <div class="filter-tags" id="zone-tags"></div>
                    </div>
                </div>

                <!-- Performance Categories -->
                <div class="filter-tags-container category-filter-container">
                    <div class="filter-group">
                        <span class="filter-group-label">Category:</span>
                        <div class="filter-tags" id="category-tags"></div>
                    </div>
                </div>
            </div>
        `;

		$(html).appendTo(this.drishti_container);
		this.populateFilterTags();
	}

	populateFilterTags() {
		this.updateZoneTags();
		this.updateCategoryTags();
	}

	updateZoneTags() {
		const container = this.page.main.find("#zone-tags");
		container.empty();

		const allZonesCount = this.zoneCounts["all"] || 0;
		const allZonesActive = this.state.selectedZones.length === 0;

		// Calculate zone percentages using Largest Remainder Method
		const zonePercentages = {};
		if (allZonesCount === 0) {
			zonePercentages["all"] = 100;
			this.availableFilters.zones.forEach((z) => {
				zonePercentages[z] = 0;
			});
		} else {
			zonePercentages["all"] = 100;
			let sumFloors = 0;
			const items = [];

			this.availableFilters.zones.forEach((zone) => {
				const count = this.zoneCounts[zone] || 0;
				const exact = (count / allZonesCount) * 100;
				const floorVal = Math.floor(exact);
				sumFloors += floorVal;
				items.push({
					zone: zone,
					exact: exact,
					floorVal: floorVal,
					remainder: exact - floorVal,
				});
			});

			let diff = 100 - sumFloors;
			items.sort((a, b) => b.remainder - a.remainder);

			items.forEach((item, index) => {
				let finalVal = item.floorVal;
				if (index < diff) {
					finalVal += 1;
				}
				zonePercentages[item.zone] = finalVal;
			});
		}

		container.append(`
            <button class="filter-tag zone-tag ${allZonesActive ? "active" : ""}" data-zone="all">
                <span class="zone-tag-content">
                    All
                    <span class="filter-tag-count">${allZonesCount}</span>
                    <span class="zone-tag-pct">${zonePercentages["all"]}%</span>
                </span>
            </button>
        `);

		this.availableFilters.zones.forEach((zone) => {
			const count = this.zoneCounts[zone] || 0;
			const isActive = this.state.selectedZones.includes(zone);
			const zoneNum = zone.match(/\d+/);
			const displayName = zoneNum ? `Zone ${zoneNum[0]}` : zone;
			const pct = zonePercentages[zone];

			container.append(`
                <button class="filter-tag zone-tag ${
					isActive ? "active" : ""
				}" data-zone="${zone}">
                    <span class="zone-tag-content">
                        ${displayName}
                        <span class="filter-tag-count">${count}</span>
                        <span class="zone-tag-pct">${pct}%</span>
                    </span>
                </button>
            `);
		});

		this.attachZoneTagEvents();
	}

	updateCategoryTags() {
		const container = this.page.main.find("#category-tags");
		container.empty();

		const categoryColors = {
			Pinnacle: "#6D28D9",
			Master: "#1D4ED8",
			Accelerator: "#047857",
			Starter: "#B45309",
			Learner: "#BE185D",
			"Zero Level": "#991B1B",
		};

		const allCategoriesCount = this.categoryCounts["all"] || 0;
		const allCategoriesActive = this.state.selectedCategories.length === 0;

		// Calculate percentages using Largest Remainder Method to ensure total is exactly 100%
		const percentages = {};
		if (allCategoriesCount === 0) {
			percentages["all"] = 100;
			this.availableFilters.categories.forEach((cat) => {
				percentages[cat] = 0;
			});
		} else {
			percentages["all"] = 100;
			let sumFloors = 0;
			const items = [];

			this.availableFilters.categories.forEach((cat) => {
				const count = this.categoryCounts[cat] || 0;
				const exact = (count / allCategoriesCount) * 100;
				const floorVal = Math.floor(exact);
				sumFloors += floorVal;
				items.push({
					category: cat,
					exact: exact,
					floorVal: floorVal,
					remainder: exact - floorVal,
				});
			});

			let diff = 100 - sumFloors;
			items.sort((a, b) => b.remainder - a.remainder);

			items.forEach((item, index) => {
				let finalVal = item.floorVal;
				if (index < diff) {
					finalVal += 1;
				}
				percentages[item.category] = finalVal;
			});
		}

		container.append(`
            <button class="filter-tag category-tag all-tag ${
				allCategoriesActive ? "active" : ""
			}" data-category="all" style="--fill-pct: ${percentages["all"]}%; --fill-color: #cbd5e133; color: #475569;">
                <span class="category-tag-content">
                    All
                    <span class="filter-tag-count">${allCategoriesCount}</span>
                    <span class="category-tag-pct">${percentages["all"]}%</span>
                </span>
            </button>
        `);

		this.availableFilters.categories.forEach((category) => {
			const count = this.categoryCounts[category] || 0;
			const isActive = this.state.selectedCategories.includes(category);
			const color = categoryColors[category] || "#778da9";
			const pct = percentages[category];

			container.append(`
                <button class="filter-tag category-tag ${isActive ? "active" : ""}" 
                        data-category="${category}" 
                        style="--fill-pct: ${pct}%; --fill-color: ${color}26; color: ${color}; border-color: ${color}40;">
                    <span class="category-tag-content">
                        <span class="category-tag-name" style="color: ${color}; font-weight: 700;">${category}</span>
                        <span class="filter-tag-count" style="color: ${color}; border-color: ${color}50; background-color: ${color}15;">${count}</span>
                        <span class="category-tag-pct" style="color: ${color}; font-weight: 700;">${pct}%</span>
                    </span>
                </button>
            `);
		});

		this.attachCategoryTagEvents();
	}

	attachZoneTagEvents() {
		const self = this;

		this.page.main
			.find(".zone-tag")
			.off("click")
			.on("click", function () {
				const zone = $(this).data("zone");

				if (zone === "all") {
					self.state.selectedZones = [];
				} else {
					const index = self.state.selectedZones.indexOf(zone);
					if (index > -1) {
						self.state.selectedZones.splice(index, 1);
					} else {
						self.state.selectedZones.push(zone);
					}
				}

				self.updateFilterTagsUI();
				self.updateUrlFromState();
				self.render();
			});
	}

	attachCategoryTagEvents() {
		const self = this;

		this.page.main
			.find(".category-tag")
			.off("click")
			.on("click", function () {
				const category = $(this).data("category");

				if (category === "all") {
					self.state.selectedCategories = [];
				} else {
					const index = self.state.selectedCategories.indexOf(category);
					if (index > -1) {
						self.state.selectedCategories.splice(index, 1);
					} else {
						self.state.selectedCategories.push(category);
					}
				}

				self.updateFilterTagsUI();
				self.updateUrlFromState();
				self.render();
			});
	}

	updateFilterTagsUI() {
		// Zone tags
		this.page.main.find(".zone-tag").removeClass("active");
		if (this.state.selectedZones.length === 0) {
			this.page.main.find(".zone-tag[data-zone='all']").addClass("active");
		} else {
			this.state.selectedZones.forEach((zone) => {
				this.page.main.find(`.zone-tag[data-zone="${zone}"]`).addClass("active");
			});
		}

		// Category tags
		this.page.main.find(".category-tag").removeClass("active");
		if (this.state.selectedCategories.length === 0) {
			this.page.main.find(".category-tag[data-category='all']").addClass("active");
		} else {
			this.state.selectedCategories.forEach((category) => {
				this.page.main
					.find(`.category-tag[data-category="${category}"]`)
					.addClass("active");
			});
		}
	}

	updateFilterCounts() {
		if (!this.branchData) return;

		let filteredBranches = this.branchData;

		// Apply zone filter
		if (this.state.selectedZones.length > 0) {
			filteredBranches = filteredBranches.filter((b) =>
				this.state.selectedZones.includes(b.zone),
			);
		}

		// Apply region filter
		if (this.state.selectedRegions && this.state.selectedRegions.length > 0) {
			filteredBranches = filteredBranches.filter((b) =>
				this.state.selectedRegions.includes(b.region),
			);
		}

		this.categoryCounts.all = filteredBranches.length;
		this.zoneCounts.all = filteredBranches.length;

		const firstMonth = this.months[0]?.key;
		if (firstMonth) {
			this.availableFilters.categories.forEach((catName) => {
				this.categoryCounts[catName] = filteredBranches.filter(
					(b) => b.months[firstMonth]?.category === catName,
				).length;
			});
		}

		this.availableFilters.zones.forEach((zone) => {
			this.zoneCounts[zone] = this.branchData.filter((b) => b.zone === zone).length;
		});

		this.populateFilterTags();
	}

	// ========================================================================
	// TABS - Zone Wise, Category Wise, Branch Wise
	// ========================================================================
	createTabsAndContainer() {
		const html = `
            <div style="border: 1px solid #cbd5e1; padding: 8px 12px; background: #fff; border-radius: 8px; margin-top: 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);">
                <!-- Filters Row -->
                <div style="display: flex; align-items: center; gap: 15px; flex-wrap: wrap; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #ddd;">
                    <!-- FY Selector -->
                    <div class="outlined-input-container fy-header-control">
                        <label class="outlined-input-label">FY</label>
                        <select id="fy-selector" style="width: 110px;">
                        </select>
                    </div>

                    <!-- Date Selector -->
                    <div id="date-selector-container" class="outlined-input-container">
                        <label class="outlined-input-label">Date</label>
                    </div>

                    <!-- Month Selector (shown only when view is Monthly) -->
                    <div id="month-selector-container" class="outlined-input-container" style="display: none;">
                        <label class="outlined-input-label">Month</label>
                        <select id="month-selector" style="width: 110px;">
                            <option value="4">April</option>
                            <option value="5">May</option>
                            <option value="6">June</option>
                            <option value="7">July</option>
                            <option value="8">August</option>
                            <option value="9">September</option>
                            <option value="10">October</option>
                            <option value="11">November</option>
                            <option value="12">December</option>
                            <option value="1">January</option>
                            <option value="2">February</option>
                            <option value="3">March</option>
                        </select>
                    </div>

                    <!-- Days Left countdown -->
                    <div style="display: flex; align-items: center;">
                        <span id="drishti-live-timer" style="font-size: 13px; font-weight: 600; color: #64748b; white-space: nowrap;"></span>
                    </div>

                    <!-- View Toggle Buttons -->
                    <div style="display: flex; align-items: center;">
                        <label style="font-weight: bold; color: #0d1b2a; margin-bottom: 0;">View:</label>
                        <div class="btn-group" id="view-controls" role="group" style="margin-left: 8px;">
                            <button type="button" class="btn btn-sm view-toggle-btn" data-view="Monthly">Monthly</button>
                            <button type="button" class="btn btn-sm view-toggle-btn" data-view="Quarterly">Quarterly</button>
                            <button type="button" class="btn btn-sm view-toggle-btn" data-view="Yearly">Yearly</button>
                        </div>

                        <!-- Quarter Selector (hidden by default) -->
                        <div id="quarter-selector-container" style="display: none; margin-left: 10px;">
                            <div class="btn-group" role="group">
                                <button type="button" class="btn btn-sm quarter-toggle-btn" data-quarter="Q1">Q1</button>
                                <button type="button" class="btn btn-sm quarter-toggle-btn" data-quarter="Q2">Q2</button>
                                <button type="button" class="btn btn-sm quarter-toggle-btn" data-quarter="Q3">Q3</button>
                                <button type="button" class="btn btn-sm quarter-toggle-btn" data-quarter="Q4">Q4</button>
                            </div>
                        </div>
                    </div>
 
                    <!-- Target Toggle Buttons -->
                    <div style="display: flex; align-items: center;">
                        <label style="font-weight: bold; color: #0d1b2a; margin-bottom: 0;">Target:</label>
                        <div class="btn-group" role="group" style="margin-left: 8px;">
                            <button type="button" class="btn btn-sm target-toggle-btn" data-target="Monthly">Monthly</button>
                            <button type="button" class="btn btn-sm target-toggle-btn" data-target="YTD">YTD</button>
                            <button type="button" class="btn btn-sm target-toggle-btn" data-target="Yearly">Yearly</button>
                        </div>
                    </div>
 
                    <!-- Region Filter (Multi-select dropdown) -->
                    <div class="dropdown outlined-input-container" id="region-dropdown-container">
                        <label class="outlined-input-label">Region</label>
                        <button class="btn btn-default btn-sm dropdown-toggle" type="button" id="region-dropdown-btn" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="min-width: 150px; text-align: left; display: inline-flex; align-items: center; justify-content: space-between;">
                            <span id="region-dropdown-label">All Regions</span>
                            <span class="caret" style="margin-left: 8px;"></span>
                        </button>
                        <ul class="dropdown-menu" id="region-dropdown-menu" aria-labelledby="region-dropdown-btn" style="max-height: 250px; overflow-y: auto; padding: 5px 0; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); width: 220px;">
                        </ul>
                    </div>

                    <!-- District Filter (Multi-select dropdown) -->
                    <div class="dropdown outlined-input-container" id="district-dropdown-container">
                        <label class="outlined-input-label">District</label>
                        <button class="btn btn-default btn-sm dropdown-toggle" type="button" id="district-dropdown-btn" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" style="min-width: 150px; text-align: left; display: inline-flex; align-items: center; justify-content: space-between;">
                            <span id="district-dropdown-label">All Districts</span>
                            <span class="caret" style="margin-left: 8px;"></span>
                        </button>
                        <ul class="dropdown-menu" id="district-dropdown-menu" aria-labelledby="district-dropdown-btn" style="max-height: 250px; overflow-y: auto; padding: 5px 0; border: 1px solid #cbd5e1; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); width: 220px;">
                        </ul>
                    </div>

                    <!-- Format Control -->
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-weight: bold; color: #0d1b2a; font-size: 13px; white-space: nowrap;">Format:</span>
                        <div class="btn-group" role="group">
                            <button type="button" class="btn btn-sm format-toggle-btn" data-format="number">Numbers</button>
                            <button type="button" class="btn btn-sm format-toggle-btn" data-format="words">Words</button>
                        </div>
                    </div>
                </div>

                <div id="tab-buttons" style="display: flex; align-items: center; gap: 24px; margin-bottom: 0; border-bottom: 2px solid #cbd5e1; width: 100%;">
                    <button class="tab-btn" data-tab="zone">
                        Zone Wise
                    </button>
                    <button class="tab-btn" data-tab="category">
                        Category Wise
                    </button>
                    <button class="tab-btn" data-tab="product">
                        Product Wise
                    </button>	
                    <button class="tab-btn" data-tab="agent">
                        Agent Wise
                    </button>									
                    <button class="tab-btn" data-tab="branch">
                        Branch Wise
                    </button>
                    <button class="tab-btn" data-tab="product_tgt_ach">
                        Product Wise TGT VS ACH
                    </button>

                    <!-- Search and Clear Actions -->
                    <div style="margin-left: auto; display: flex; align-items: center; gap: 10px; padding-bottom: 6px;">
						<select id="segment-filter" style="padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 4px; background: white; color: #1b263b;">
							<option value="all">All Segments</option>
							<option value="Top 25%">Top 25%</option>
							<option value="Next 25%">Next 25%</option>
							<option value="Mid 25%">Mid 25%</option>
							<option value="Bottom 25%">Bottom 25%</option>
						</select>
                        <input type="text" id="branch-search" placeholder="Search branch or SOL ID (comma separated)..." 
                               style="padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 4px; min-width: 250px; background: white; color: #1b263b;" />
                        <button id="clear-filters" class="btn btn-secondary btn-sm" 
                                style="background: #417d81; border-color: #1b263b; color: white; font-weight: 600;"
                                title="Resets all filters to their default state and refreshes the dashboard.">
                            🔄 Reset & Refresh
                        </button>
                    </div>
                </div>

                <div id="error-message" style="color: #0d1b2a; display: none; padding: 10px; background: #ffebee; border-radius: 4px;"></div>

                <div id="tab-content" style="overflow: auto; max-height: 75vh;">
                    <div id="data-container" style="transition: opacity 0.2s ease-in-out;"></div>
                </div>
            </div>
        `;

		$(html).appendTo(this.drishti_container);
		this.attachTabEvents();
		this.applyBranchManagerRestrictions();
	}

	attachTabEvents() {
		const self = this;

		// Tab buttons
		this.page.main.find(".tab-btn").on("click", function () {
			const tabId = $(this).data("tab");
			self.switchTab(tabId);
		});

		// Branch Search with debounce
		let searchTimeout;
		this.page.main.find("#branch-search").on("input", function () {
			clearTimeout(searchTimeout);
			searchTimeout = setTimeout(() => {
				self.state.branchSearchTerm = $(this).val() || "";
				self.updateUrlFromState();
				if (self.state.branchSearchTerm && self.state.activeTab !== "branch") {
					self.switchTab("branch");
				} else {
					self.render();
				}
			}, 300);
		});

		// Financial Year
		$(document)
			.off("change", "#fy-selector")
			.on("change", "#fy-selector", function () {
				self.state.financialYear = $(this).val();
				self.applyPreviousFinancialYearDefaultDate();
				self.updateUrlFromState();
				self._dataLoaded = false;
				self.loadData();
			});

		// View Toggle Buttons
		this.page.main.find(".view-toggle-btn").on("click", function () {
			self.page.main.find(".view-toggle-btn").removeClass("active");
			$(this).addClass("active");
			self.clearViewControlsHighlight();
			self.state.viewType = $(this).data("view");

			if (self.state.viewType === "Quarterly") {
				self.state.selectedMonth = null;
				const currentQ = self.getQuarterFromDate(frappe.datetime.get_today());
				self.state.selectedQuarter = currentQ;
				self.state.selectedDate = self.getQuarterDate(currentQ, self.state.financialYear);
			} else if (self.state.viewType === "Monthly") {
				self.state.selectedQuarter = null;
				if (self.isPreviousFinancialYear()) {
					self.applyPreviousFinancialYearDefaultDate();
				} else {
					self.state.selectedDate = frappe.datetime.get_today();
				}
			} else {
				self.state.selectedQuarter = null;
				self.applyPreviousFinancialYearDefaultDate();
			}

			self.updateUrlFromState();
			self.updateUiFromState();
			self._dataLoaded = false;
			self.loadData();
		});

		this.page.main
			.find("#error-message")
			.on("click", ".view-change-option-link", function (e) {
				e.preventDefault();
				const view = $(this).data("view");
				self.page.main.find(`.view-toggle-btn[data-view="${view}"]`).trigger("click");
			});

		// Quarter Toggle Buttons
		this.page.main.find(".quarter-toggle-btn").on("click", function () {
			self.state.selectedMonth = null;
			self.state.selectedQuarter = $(this).data("quarter");
			self.state.selectedDate = self.getQuarterDate(
				self.state.selectedQuarter,
				self.state.financialYear,
			);
			self.updateUrlFromState();
			self.updateUiFromState();
			self._dataLoaded = false;
			self.loadData();
		});

		// Month Selector change
		this.page.main.on("change", "#month-selector", function () {
			const selectedMonthNum = parseInt($(this).val()); // 1 to 12

			const now = new Date();
			const currentMonth = now.getMonth() + 1; // 1-12
			const currentYear = now.getFullYear();

			const startYear = parseInt(self.state.financialYear.split("-")[0]);
			const endYear = parseInt(self.state.financialYear.split("-")[1]);

			const selectedYear = selectedMonthNum >= 4 ? startYear : endYear;

			const isFuture =
				selectedYear > currentYear ||
				(selectedYear === currentYear && selectedMonthNum > currentMonth);

			if (isFuture) {
				frappe.show_alert({
					message: __("Future months cannot be accessed"),
					indicator: "orange",
				});
				const dateToUse = self.state.selectedDate || frappe.datetime.get_today();
				const prevMonthVal = new Date(dateToUse).getMonth() + 1;
				$(this).val(prevMonthVal);
				return;
			}

			let newDateStr = "";
			if (selectedYear === currentYear && selectedMonthNum === currentMonth) {
				const todayObj = new Date();
				newDateStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, "0")}-${String(todayObj.getDate()).padStart(2, "0")}`;
			} else {
				const lastDay = new Date(selectedYear, selectedMonthNum, 0).getDate();
				newDateStr = `${selectedYear}-${String(selectedMonthNum).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
			}

			self.state.selectedDate = newDateStr;
			if (self.state.activeTab && self.tabDates.hasOwnProperty(self.state.activeTab)) {
				self.tabDates[self.state.activeTab] = newDateStr;
			}

			// Automatically update selected month name key
			const monthNames = [
				"JAN",
				"FEB",
				"MAR",
				"APR",
				"MAY",
				"JUN",
				"JUL",
				"AUG",
				"SEP",
				"OCT",
				"NOV",
				"DEC",
			];
			self.state.selectedMonth = monthNames[selectedMonthNum - 1];

			self.updateDatePickerValue(newDateStr);
			self.updateUrlFromState();
			self._dataLoaded = false;
			self.loadData();
		});

		// Target Toggle Buttons
		this.page.main.find(".target-toggle-btn").on("click", function () {
			self.page.main.find(".target-toggle-btn").removeClass("active");
			$(this).addClass("active");
			self.state.targetType = self.normalizeTargetType($(this).data("target"));
			self.updateUrlFromState();
			self._dataLoaded = false;
			self.loadData();
		});

		// Format Toggle
		$(document)
			.off("click", ".format-toggle-btn")
			.on("click", ".format-toggle-btn", function () {
				$(".format-toggle-btn").removeClass("active");
				$(this).addClass("active");
				self.state.formatMode = $(this).data("format");
				self.updateUrlFromState();
				self.render();
			});

		// Region Filter - All Regions checkbox change
		this.page.main.on("change", "#region-all-checkbox", function () {
			const isChecked = $(this).prop("checked");
			if (isChecked) {
				self.state.selectedRegions = [];
			} else {
				self.state.selectedRegions = [...self.availableFilters.regions];
			}
			self.updateRegionDropdownUI();
			self.updateUrlFromState();
			self.loadData();
		});

		// Region Filter - Individual checkbox change
		this.page.main.on("change", ".region-checkbox", function () {
			const region = $(this).val();
			const isChecked = $(this).prop("checked");

			if (isChecked) {
				if (!self.state.selectedRegions.includes(region)) {
					self.state.selectedRegions.push(region);
				}
			} else {
				const index = self.state.selectedRegions.indexOf(region);
				if (index > -1) {
					self.state.selectedRegions.splice(index, 1);
				}
			}

			// If all individual regions are selected, we can optionally clear the array to signify "All Regions"
			if (self.state.selectedRegions.length === self.availableFilters.regions.length) {
				self.state.selectedRegions = [];
			}

			self.updateRegionDropdownUI();
			self.updateUrlFromState();
			self.loadData();
		});

		// Prevent dropdown from closing when clicking inside the menu
		this.page.main.on("click", "#region-dropdown-menu", function (e) {
			e.stopPropagation();
		});

		// District Filter - All Districts checkbox change
		this.page.main.on("change", "#district-all-checkbox", function () {
			const isChecked = $(this).prop("checked");
			if (isChecked) {
				self.state.selectedDistricts = [];
			} else {
				self.state.selectedDistricts = [...self.availableFilters.districts];
			}
			self.updateDistrictDropdownUI();
			self.updateUrlFromState();
			self.render();
		});

		// District Filter - Individual checkbox change
		this.page.main.on("change", ".district-checkbox", function () {
			const district = $(this).val();
			const isChecked = $(this).prop("checked");

			if (isChecked) {
				if (!self.state.selectedDistricts.includes(district)) {
					self.state.selectedDistricts.push(district);
				}
			} else {
				const index = self.state.selectedDistricts.indexOf(district);
				if (index > -1) {
					self.state.selectedDistricts.splice(index, 1);
				}
			}

			if (self.state.selectedDistricts.length === self.availableFilters.districts.length) {
				self.state.selectedDistricts = [];
			}

			self.updateDistrictDropdownUI();
			self.updateUrlFromState();
			self.render();
		});

		// Prevent dropdown from closing when clicking inside the menu
		this.page.main.on("click", "#district-dropdown-menu", function (e) {
			e.stopPropagation();
		});

		// District search filter
		this.page.main.on("input", "#district-search-input", function () {
			const searchText = $(this).val().toLowerCase();
			const menu = self.page.main.find("#district-dropdown-menu");
			menu.find("li.district-item").each(function () {
				const label = $(this).find("label").text().trim().toLowerCase();
				$(this).toggle(label.includes(searchText));
			});
		});

		// Clear Filters
		this.page.main.find("#clear-filters").on("click", function () {
			history.pushState({}, "", window.location.pathname);
			location.reload(true);
		});

		// Segment Filter
		this.page.main.find("#segment-filter").on("change", function () {
			self.state.selectedSegment = $(this).val();
			self.updateUrlFromState();
			self.render();
		});
	}

	switchTab(tabId) {
		if (this.isBranchManager && ["zone", "category", "product", "agent", "product_tgt_ach"].includes(tabId)) {
			tabId = "branch";
		}

		// Save current tab's date before switching
		if (this.state.activeTab && this.tabDates.hasOwnProperty(this.state.activeTab)) {
			this.tabDates[this.state.activeTab] = this.state.selectedDate;
		}

		this.state.activeTab = tabId;

		if (tabId === "product_tgt_ach") {
			this.isProductTgtAchLoading = true;
			this.productTgtAchRawData = null;
		}

		// Reset data loaded flag so loadData() fetches fresh for new tab
		this._dataLoaded = false;

		// Clear data container immediately to remove old tab content
		const dataContainer = this.page.main.find("#data-container");
		dataContainer.css("opacity", 0);
		if (tabId === "product_tgt_ach") {
			dataContainer.html(this.buildMisSkeletonTable("Loading Product Wise TGT VS ACH..."));
		} else {
			dataContainer.html(this._buildLoadingSkeleton());
		}
		dataContainer.css("opacity", 1);
		this.page.main.find("#summary-cards-container").hide();

		// Update tab button UI immediately to show the tab as active
		this.page.main.find(".tab-btn").removeClass("active");
		this.page.main.find(`.tab-btn[data-tab="${tabId}"]`).addClass("active");

		// Restore the target tab's previously selected date
		const savedDate = this.tabDates[tabId] || null;

		// SPECIAL CASE: For Agent and Product Wise tabs, default to LATEST AVAILABLE DATE
		if (tabId === "agent" || tabId === "product") {
			const self = this;
			const method =
				tabId === "agent"
					? "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_latest_agent_report_date"
					: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_latest_product_report_date";

			frappe.call({
				method: method,
				callback: (r) => {
					let dateStr = r.message;
					if (!dateStr) {
						// Fallback to yesterday if no data exists
						const d = new Date();
						d.setDate(d.getDate() - 1);
						dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
					}

					// Use saved date if available, otherwise use latest date from server
					self.state.selectedDate = savedDate || dateStr;

					if (self.state.selectedDate) {
						const monthNames = [
							"JAN",
							"FEB",
							"MAR",
							"APR",
							"MAY",
							"JUN",
							"JUL",
							"AUG",
							"SEP",
							"OCT",
							"NOV",
							"DEC",
						];
						const monthNum = parseInt(self.state.selectedDate.split("-")[1], 10);
						self.state.selectedMonth = monthNames[monthNum - 1];
					}

					// Update date control properly
					if (self.dateControl) {
						self.isRefreshingDate = true;
						self.dateControl.set_value(self.state.selectedDate);
						self.isRefreshingDate = false;
					}

					self.updateUiFromState();
					self.updateUrlFromState();
					self.loadData();
				},
			});
			return;
		}

		// For other tabs, restore saved date or use today's date for data loading
		if (savedDate) {
			this.state.selectedDate = savedDate;
			if (this.dateControl) {
				this.isRefreshingDate = true;
				this.dateControl.set_value(savedDate);
				this.isRefreshingDate = false;
			}
			// Load data with restored date
			this.loadData();
		} else {
			// Clear date selector (show blank DD/MM/YY) but use today's date for API
			this.state.selectedDate = null;
			if (this.dateControl) {
				this.isRefreshingDate = true;
				this.dateControl.set_value(null);
				this.isRefreshingDate = false;
			}
			// Load data with yesterday's date (default) - but don't show it in selector
			this.loadDataWithDate(frappe.datetime.add_days(frappe.datetime.get_today(), -1));
		}

		this.updateUiFromState();
		this.updateUrlFromState();
		// Don't call render() here - loadData() callback will call it
	}

	// Helper to load data with a specific date (for internal use)
	loadDataWithDate(dateStr) {
		const self = this;
		const apiDate =
			dateStr ||
			this.state.selectedDate ||
			this.getPreviousFinancialYearDefaultDate() ||
			frappe.datetime.add_days(frappe.datetime.get_today(), -1);

		// Show loading skeleton in data container
		const dataContainer = this.page.main.find("#data-container");
		if (dataContainer.length && !dataContainer.find(".drishti-skeleton").length) {
			dataContainer.css("opacity", 0);
			dataContainer.html(this._buildLoadingSkeleton());
			dataContainer.css("opacity", 1);
		}
		// Hide summary cards while loading
		this.page.main.find("#summary-cards-container").hide();

		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_sahayog_dashboard",
			args: {
				financial_year: this.state.financialYear,
				view: this.getDashboardViewForRequest(),
				target_type: this.normalizeTargetType(this.state.targetType),
				filters: JSON.stringify({
					zones: [],
				}),
				selected_date: apiDate,
			},
			callback: (r) => {
				if (r.message) {
					self.normalizeDashboardResponse(r.message);
					self.data = r.message;
					self.permissions = r.message.permissions;

					// Check if data is empty (all zeros) - if so, try to get latest available date
					if (self.branchData && self.branchData.length > 0) {
						const firstBranch = self.branchData[0];
						const firstMonthKey = self.months?.[0]?.key;
						const monthData = firstBranch.months?.[firstMonthKey];

						if (monthData && monthData.target === 0 && monthData.achievement === 0) {
							self.loadLatestAvailableDate();
							return;
						}
					}

					if (self.permissions && self.permissions.has_access === false) {
						self.page.main.html(`
							<div style="text-align: center; padding: 100px 20px;">
								<div style="font-size: 60px; margin-bottom: 20px;">🚫</div>
								<h2 style="color: #d32f2f;">Access Denied</h2>
								<p style="font-size: 16px; color: #666;">
									You do not have a <b>Report Preference</b> set up. <br>
									Please contact your administrator to grant access.
								</p>
							</div>
						`);
						return;
					}

					// Update selectedDate if empty to reflect the actual loaded date
					if (
						!self.state.selectedDate &&
						r.message.months &&
						r.message.months.length > 0
					) {
						const latestMonth = r.message.months[r.message.months.length - 1];
						if (latestMonth && latestMonth.date) {
							self.state.selectedDate = latestMonth.date;
							if (
								self.state.activeTab &&
								self.tabDates.hasOwnProperty(self.state.activeTab)
							) {
								self.tabDates[self.state.activeTab] = latestMonth.date;
							}
							self.updateDatePickerValue(latestMonth.date);
							if (self.state.viewType === "Monthly") {
								const monthVal = new Date(latestMonth.date).getMonth() + 1;
								self.page.main.find("#month-selector").val(monthVal);
							}
							self.updateUrlFromState();
						}
					}

					self.processNewApiResponse();
					self.updateFilterCounts();
					if (self.state.activeTab === "product_tgt_ach") {
						self.isProductTgtAchLoading = true;
						const dataContainer = self.page.main.find("#data-container");
						if (dataContainer.length) {
							dataContainer.css("opacity", 1);
							dataContainer.html(self.buildMisSkeletonTable("Loading Product Wise TGT VS ACH..."));
						}
						frappe.call({
							method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_product_wise_tgt_vs_ach_data",
							args: {
								financial_year: self.state.financialYear,
								selected_date: apiDate,
								target_type: self.normalizeTargetType(self.state.targetType)
							},
							callback: (res) => {
								self.isProductTgtAchLoading = false;
								self.productTgtAchRawData = res.message || [];
								self.render();
							},
							error: () => {
								self.isProductTgtAchLoading = false;
								self.render();
							}
						});
					} else {
						self.render();
					}


				}
			},
			error: (err) => {
				self.isLoadingData = false;
				console.error("Error loading dashboard data:", err);
				self.showError("Failed to load data. Please refresh the page.");
			},
		});
	}

	// Load latest available date from backend
	loadLatestAvailableDate() {
		const self = this;

		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_latest_agent_report_date",
			callback: (r) => {
				let dateStr = r.message;
				if (!dateStr) {
					// Fallback to yesterday if no data exists
					const d = new Date();
					d.setDate(d.getDate() - 1);
					dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
				}

				// Update state and UI
				self.state.selectedDate = dateStr;
				self.tabDates[self.state.activeTab] = dateStr;

				if (self.dateControl) {
					self.isRefreshingDate = true;
					self.dateControl.set_value(dateStr);
					self.isRefreshingDate = false;
				}

				// Reload data with latest date
				self.loadData();
			},
		});
	}

	// ========================================================================
	// DATA LOADING
	// ========================================================================
	loadData() {
		if (this.state.dashboardMode === "mis") {
			const activeReportId = this.state.selectedMisReport || (this.misReportsList.length > 0 ? this.misReportsList[0].id : "");
			if (activeReportId) {
				const report = this.misReportsList.find(r => r.id === activeReportId);
				if (report) {
					if (report.cacheDate !== this.state.selectedDate) {
						report.tableData = [];
						if (report.cachedPages !== undefined) {
							report.cachedPages = {};
							report.cacheDate = null;
							report.currentPage = 1;
							report.totalRows = 0;
							report.totalPages = 0;
							report._bgRunning = false;
						}
					}
				}
				this.renderMisReport(activeReportId);
			}
			return;
		}
		if (this._dataLoaded) return;
		this._dataLoaded = true;
		const self = this;

		// Show loading skeleton in data container
		const dataContainer = this.page.main.find("#data-container");
		if (dataContainer.length && !dataContainer.find(".drishti-skeleton").length) {
			dataContainer.css("opacity", 0);
			dataContainer.html(this._buildLoadingSkeleton());
			dataContainer.css("opacity", 1);
		}
		// Hide summary cards while loading
		this.page.main.find("#summary-cards-container").hide();

		// Use state.selectedDate for API call (this is what the date selector shows)
		// Fallback to today's date if no date selected
		const apiDate =
			this.state.selectedDate ||
			this.getPreviousFinancialYearDefaultDate() ||
			frappe.datetime.add_days(frappe.datetime.get_today(), -1);

		const reqArgs = {
			financial_year: this.state.financialYear,
			view: this.getDashboardViewForRequest(),
			target_type: this.normalizeTargetType(this.state.targetType),
			filters: JSON.stringify({
				zones: [],
			}),
			selected_date: apiDate,
		};
		console.log("DEBUG: API CALL get_sahayog_dashboard START", reqArgs);

		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_sahayog_dashboard",
			args: reqArgs,
			callback: (r) => {
				console.log("DEBUG: API CALL get_sahayog_dashboard RESPONSE", r.message);
				if (r.message) {
					self.normalizeDashboardResponse(r.message);
					self.data = r.message;
					self.permissions = r.message.permissions;
					console.log("🛡️ Sahayog Dashboard Permissions:", self.permissions);
					console.log(
						`[loadData callback] Data received. branchData length: ${self.branchData?.length || 0}`,
					);

					if (self.permissions && self.permissions.has_access === false) {
						self.page.main.html(`
							<div style="text-align: center; padding: 100px 20px;">
								<div style="font-size: 60px; margin-bottom: 20px;">🚫</div>
								<h2 style="color: #d32f2f;">Access Denied</h2>
								<p style="font-size: 16px; color: #666;">
									You do not have a <b>Report Preference</b> set up. <br>
									Please contact your administrator to grant access.
								</p>
							</div>
						`);
						return;
					}

					// Update selectedDate if empty to reflect the actual loaded date
					if (
						!self.state.selectedDate &&
						r.message.months &&
						r.message.months.length > 0
					) {
						const latestMonth = r.message.months[r.message.months.length - 1];
						if (latestMonth && latestMonth.date) {
							self.state.selectedDate = latestMonth.date;
							if (
								self.state.activeTab &&
								self.tabDates.hasOwnProperty(self.state.activeTab)
							) {
								self.tabDates[self.state.activeTab] = latestMonth.date;
							}
							self.updateDatePickerValue(latestMonth.date);
							if (self.state.viewType === "Monthly") {
								const monthVal = new Date(latestMonth.date).getMonth() + 1;
								self.page.main.find("#month-selector").val(monthVal);
							}
							self.updateUrlFromState();
						}
					}

					self.processNewApiResponse();
					self.updateFilterCounts();
					self.updateUiFromState();
					self.render();
				}
			},
		});
	}

	updateRegionOptions() {
		const regionSet = new Set();
		this.zoneData.forEach((item) => {
			if (item.zone !== item.region) {
				regionSet.add(item.region);
			}
		});

		this.availableFilters.regions = Array.from(regionSet).sort();

		const menu = this.page.main.find("#region-dropdown-menu");
		if (!menu.length) return;
		menu.empty();

		// Add "All Regions" / toggle all item
		menu.append(`
			<li style="padding: 6px 12px; border-bottom: 1px solid #edf2f7; margin-bottom: 4px; white-space: nowrap; display: flex; align-items: center;">
				<label style="font-weight: bold; margin-bottom: 0; cursor: pointer; display: flex; align-items: center; width: 100%; color: #0d1b2a;">
					<input type="checkbox" id="region-all-checkbox" style="position: relative !important; margin: 0 8px 0 0 !important; cursor: pointer; width: 14px; height: 14px; vertical-align: middle;" />
					All Regions
				</label>
			</li>
		`);

		// Add each region checkbox
		this.availableFilters.regions.forEach((region) => {
			const isChecked = this.state.selectedRegions.includes(region);
			menu.append(`
				<li style="padding: 6px 12px; white-space: nowrap; display: flex; align-items: center;">
					<label style="font-weight: normal; margin-bottom: 0; cursor: pointer; display: flex; align-items: center; width: 100%; color: #1b263b;">
						<input type="checkbox" class="region-checkbox" value="${region}" ${isChecked ? "checked" : ""} style="position: relative !important; margin: 0 8px 0 0 !important; cursor: pointer; width: 14px; height: 14px; vertical-align: middle;" />
						${region}
					</label>
				</li>
			`);
		});

		this.updateRegionDropdownUI();
	}

	updateDistrictOptions() {
		const menu = this.page.main.find("#district-dropdown-menu");
		if (!menu.length) return;
		menu.empty();

		menu.append(`
			<li style="padding: 6px 12px; border-bottom: 1px solid #edf2f7; margin-bottom: 4px; white-space: nowrap; display: flex; align-items: center;">
				<label style="font-weight: bold; margin-bottom: 0; cursor: pointer; display: flex; align-items: center; width: 100%; color: #0d1b2a;">
					<input type="checkbox" id="district-all-checkbox" style="position: relative !important; margin: 0 8px 0 0 !important; cursor: pointer; width: 14px; height: 14px; vertical-align: middle;" />
					All Districts
				</label>
			</li>
			<li style="padding: 4px 12px; border-bottom: 1px solid #edf2f7; margin-bottom: 4px;">
				<input type="text" id="district-search-input" placeholder="Search district..." style="width: 100%; padding: 4px 8px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 12px; box-sizing: border-box;" />
			</li>
		`);

		this.availableFilters.districts.forEach((district) => {
			const isChecked = this.state.selectedDistricts.includes(district);
			menu.append(`
				<li class="district-item" style="padding: 6px 12px; white-space: nowrap; display: flex; align-items: center;">
					<label style="font-weight: normal; margin-bottom: 0; cursor: pointer; display: flex; align-items: center; width: 100%; color: #1b263b;">
						<input type="checkbox" class="district-checkbox" value="${district}" ${isChecked ? "checked" : ""} style="position: relative !important; margin: 0 8px 0 0 !important; cursor: pointer; width: 14px; height: 14px; vertical-align: middle;" />
						${district}
					</label>
				</li>
			`);
		});

		this.updateDistrictDropdownUI();
	}

	updateRegionDropdownUI() {
		const self = this;
		const container = this.page.main.find("#region-dropdown-container");
		if (!container.length) return;

		// Update checkboxes state
		const checkboxes = container.find(".region-checkbox");
		checkboxes.each(function () {
			const region = $(this).val();
			$(this).prop("checked", self.state.selectedRegions.includes(region));
		});

		// Update "All Regions" checkbox state
		const allCheckbox = container.find("#region-all-checkbox");
		const allSelected =
			checkboxes.length > 0 && checkboxes.length === self.state.selectedRegions.length;
		const noneSelected = self.state.selectedRegions.length === 0;

		if (noneSelected) {
			allCheckbox.prop("checked", true);
			allCheckbox.prop("indeterminate", false);
		} else if (allSelected) {
			allCheckbox.prop("checked", true);
			allCheckbox.prop("indeterminate", false);
		} else {
			allCheckbox.prop("checked", false);
			allCheckbox.prop("indeterminate", true);
		}

		// Update label
		const label = container.find("#region-dropdown-label");
		if (noneSelected) {
			label.text("All Regions");
		} else if (allSelected) {
			label.text("All Regions");
		} else if (self.state.selectedRegions.length === 1) {
			label.text(self.state.selectedRegions[0]);
		} else {
			label.text(`${self.state.selectedRegions.length} Regions`);
		}
	}

	updateDistrictDropdownUI() {
		const self = this;
		const container = this.page.main.find("#district-dropdown-container");
		if (!container.length) return;

		const checkboxes = container.find(".district-checkbox");
		checkboxes.each(function () {
			const district = $(this).val();
			$(this).prop("checked", self.state.selectedDistricts.includes(district));
		});

		const allCheckbox = container.find("#district-all-checkbox");
		const allSelected =
			checkboxes.length > 0 && checkboxes.length === self.state.selectedDistricts.length;
		const noneSelected = self.state.selectedDistricts.length === 0;

		if (noneSelected) {
			allCheckbox.prop("checked", true);
			allCheckbox.prop("indeterminate", false);
		} else if (allSelected) {
			allCheckbox.prop("checked", true);
			allCheckbox.prop("indeterminate", false);
		} else {
			allCheckbox.prop("checked", false);
			allCheckbox.prop("indeterminate", true);
		}

		const label = container.find("#district-dropdown-label");
		if (noneSelected) {
			label.text("All Districts");
		} else if (allSelected) {
			label.text("All Districts");
		} else if (self.state.selectedDistricts.length === 1) {
			label.text(self.state.selectedDistricts[0]);
		} else {
			label.text(`${self.state.selectedDistricts.length} Districts`);
		}
	}

	showError(message) {
		this.page.main.find("#error-message").text(message).show();
		this.page.main.find("#data-container").css("opacity", 0);
	}

	showQuarterlyViewSuggestion() {
		this.stopQuarterlyPromptBlink();
		this.page.main
			.find("#error-message")
			.html(
				`<div style="position: relative; overflow: hidden; margin-top: 8px; padding: 16px; border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 14px; background: linear-gradient(135deg, #fffaf0 0%, #ffefc7 100%); box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12), inset 0 1px 0 rgba(255,255,255,0.75);">
					<div style="position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255,255,255,0.18) 0, rgba(255,255,255,0) 35%), repeating-linear-gradient(135deg, rgba(180, 83, 9, 0.06) 0, rgba(180, 83, 9, 0.06) 10px, transparent 10px, transparent 20px); pointer-events: none;"></div>
					<div style="position: relative; display: flex; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
						<div style="width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: linear-gradient(180deg, #fbbf24 0%, #f59e0b 100%); color: #7c2d12; font-size: 20px; font-weight: 700; box-shadow: inset 0 1px 0 rgba(255,255,255,0.55), 0 6px 14px rgba(245, 158, 11, 0.25);">!</div>
						<div style="flex: 1 1 320px; min-width: 240px;">
							<div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; color: #92400e; margin-bottom: 6px;">Suggested Action</div>
							<div style="font-size: 22px; line-height: 1.1; font-weight: 800; color: #7c2d12; margin-bottom: 6px;">Switch View Mode</div>
							<div style="font-size: 13px; line-height: 1.5; color: #9a3412; margin-bottom: 12px;">
								No data is currently available for this month in the system. Change the View to continue, for example
								<a href="#" class="quarterly-view-link view-change-option-link" data-view="Quarterly" style="display: inline-block; margin-left: 4px; color: #7c2d12; font-weight: 800; text-decoration: underline; text-underline-offset: 2px; padding: 3px 10px; border-radius: 999px; background: rgba(245, 158, 11, 0.18); border: 1px solid rgba(245, 158, 11, 0.35); box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.10);">Quarterly</a>.
							</div>
							<div style="display: flex; gap: 10px; flex-wrap: wrap;">
								<a href="#" class="view-change-option view-change-option-link" data-view="Monthly" style="display: inline-flex; align-items: center; justify-content: center; min-width: 104px; padding: 10px 14px; border-radius: 10px; border: 1px solid #cbd5e1; background: linear-gradient(180deg, #ffffff 0%, #edf2f7 100%); color: #1b263b; font-weight: 700; text-decoration: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.85), 0 4px 0 rgba(148,163,184,0.45), 0 8px 18px rgba(15,23,42,0.12);">Monthly</a>
								<a href="#" class="view-change-option view-change-option-link is-recommended" data-view="Quarterly" style="display: inline-flex; align-items: center; justify-content: center; min-width: 104px; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(245, 158, 11, 0.45); background: linear-gradient(180deg, #ffe6a7 0%, #fbbf24 100%); color: #7c2d12; font-weight: 800; text-decoration: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.7), 0 5px 0 rgba(180,83,9,0.45), 0 10px 24px rgba(245,158,11,0.24); animation: quarterlyLinkBlink 1s ease-in-out infinite;">Quarterly</a>
								<a href="#" class="view-change-option view-change-option-link" data-view="Yearly" style="display: inline-flex; align-items: center; justify-content: center; min-width: 104px; padding: 10px 14px; border-radius: 10px; border: 1px solid #cbd5e1; background: linear-gradient(180deg, #ffffff 0%, #edf2f7 100%); color: #1b263b; font-weight: 700; text-decoration: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.85), 0 4px 0 rgba(148,163,184,0.45), 0 8px 18px rgba(15,23,42,0.12);">Yearly</a>
							</div>
						</div>
					</div>
				</div>`,
			)
			.show();
		this.page.main.find("#data-container").css("opacity", 0);
		this.startQuarterlyPromptBlink();
	}

	startQuarterlyPromptBlink() {
		this.stopQuarterlyPromptBlink();
		const button = this.page.main.find(
			'#error-message .view-change-option-link.is-recommended[data-view="Quarterly"]',
		);
		if (!button.length) return;

		let isDimmed = false;
		this.quarterlyPromptBlinkInterval = setInterval(() => {
			isDimmed = !isDimmed;
			button.css({
				opacity: isDimmed ? "0.65" : "1",
				transform: isDimmed ? "scale(0.98)" : "scale(1.05)",
				boxShadow: isDimmed
					? "inset 0 1px 0 rgba(255,255,255,0.7), 0 3px 0 rgba(180,83,9,0.35), 0 6px 14px rgba(245,158,11,0.18)"
					: "inset 0 1px 0 rgba(255,255,255,0.7), 0 6px 0 rgba(180,83,9,0.5), 0 12px 28px rgba(245,158,11,0.3)",
			});
		}, 450);
	}

	stopQuarterlyPromptBlink() {
		if (this.quarterlyPromptBlinkInterval) {
			clearInterval(this.quarterlyPromptBlinkInterval);
			this.quarterlyPromptBlinkInterval = null;
		}
	}

	highlightViewControls() {
		const viewControls = this.page.main.find("#view-controls");
		viewControls.removeClass("view-change-highlight");
		void viewControls[0]?.offsetWidth;
		viewControls.addClass("view-change-highlight");
	}

	clearViewControlsHighlight() {
		this.page.main.find("#view-controls").removeClass("view-change-highlight");
		this.stopQuarterlyPromptBlink();
	}

	getLocationIdentifier(value) {
		const text = cstr(value || "").trim();
		const numericMatch = text.match(/\d+/);
		return numericMatch ? numericMatch[0] : text.toLowerCase();
	}

	// ========================================================================
	// DATA FILTERING AND AGGREGATION UTILITIES
	// ========================================================================

	getFilteredBranches() {
		let filtered = this.branchData ? [...this.branchData] : [];

		const filterMonthKey =
			this.state.selectedMonth ||
			(this.months && this.months.length > 0 ? this.months[0].key : null);

		// 1. Category filter (applied for the selected/latest month)
		if (this.state.selectedCategories.length > 0 && filterMonthKey) {
			filtered = filtered.filter((branch) => {
				const monthData = branch.months[filterMonthKey];
				return monthData && this.state.selectedCategories.includes(monthData.category);
			});
		}

		// 2. Zone filter
		if (this.state.selectedZones.length > 0) {
			filtered = filtered.filter((branch) =>
				this.state.selectedZones.some(
					(zone) =>
						this.getLocationIdentifier(zone) ===
						this.getLocationIdentifier(branch.zone),
				),
			);
		}

		// 3. Region filter
		if (this.state.selectedRegions && this.state.selectedRegions.length > 0) {
			filtered = filtered.filter((branch) =>
				this.state.selectedRegions.some(
					(region) =>
						this.getLocationIdentifier(region) ===
						this.getLocationIdentifier(branch.region),
				),
			);
		}

		// 4. District filter
		if (this.state.selectedDistricts && this.state.selectedDistricts.length > 0) {
			filtered = filtered.filter((branch) =>
				this.state.selectedDistricts.some(
					(district) =>
						this.getLocationIdentifier(district) ===
						this.getLocationIdentifier(branch.district),
				),
			);
		}

		// 5. Branch search term filter (supports comma-separated multi-search)
		if (this.state.branchSearchTerm) {
			const searchTerms = this.state.branchSearchTerm
				.toLowerCase()
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			if (searchTerms.length > 0) {
				filtered = filtered.filter((branch) => {
					const branchName = (branch.branch || "").toLowerCase();
					const solId = (branch.sol_id || "").toLowerCase();
					return searchTerms.some(
						(term) => branchName.includes(term) || solId.includes(term),
					);
				});
			}
		}

		return filtered;
	}

	getFilteredProductData() {
		if (!this.state.selectedDistricts || this.state.selectedDistricts.length === 0) {
			return this.productData;
		}

		const selectedNames = new Set(
			this.state.selectedDistricts.map((d) => d.toLowerCase().trim()),
		);

		const matchingDistrictPaths = new Set();
		const matchingRegionPaths = new Set();
		const matchingZonePaths = new Set();

		this.productData.forEach((item) => {
			if (item.type === "district" && selectedNames.has(item.name.toLowerCase().trim())) {
				matchingDistrictPaths.add(item.path);
				matchingRegionPaths.add(item.parent_region);
				matchingZonePaths.add(item.parent_zone);
			}
		});

		if (matchingZonePaths.size === 0) return [];

		return this.productData.filter((item) => {
			if (item.type === "zone") return matchingZonePaths.has(item.path);
			if (item.type === "region") return matchingRegionPaths.has(item.path);
			if (item.type === "district") return matchingDistrictPaths.has(item.path);
			if (item.type === "sol") return matchingDistrictPaths.has(item.parent_district);
			return true;
		});
	}

	reaggregateZoneData(branches) {
		if (!branches || !this.months || this.months.length === 0) return [];

		const groupedData = {};

		branches.forEach((branch) => {
			const zoneName = branch.zone;
			const regionName = branch.region;
			const districtName = branch.district || "Unknown District";

			if (!groupedData[zoneName]) {
				groupedData[zoneName] = { totalBranches: [], regionBranches: {} };
			}
			groupedData[zoneName].totalBranches.push(branch);

			if (regionName && regionName !== zoneName) {
				if (!groupedData[zoneName].regionBranches[regionName]) {
					groupedData[zoneName].regionBranches[regionName] = { branches: [], districts: {} };
				}
				groupedData[zoneName].regionBranches[regionName].branches.push(branch);
				if (!groupedData[zoneName].regionBranches[regionName].districts[districtName]) {
					groupedData[zoneName].regionBranches[regionName].districts[districtName] = [];
				}
				groupedData[zoneName].regionBranches[regionName].districts[districtName].push(branch);
			}
		});

		const result = [];
		const sortedZoneNames = Object.keys(groupedData).sort((a, b) => {
			const aNum = a.match(/ZONE-(\d+)/)?.[1];
			const bNum = b.match(/ZONE-(\d+)/)?.[1];
			return aNum && bNum ? parseInt(aNum) - parseInt(bNum) : a.localeCompare(b);
		});

		const aggregateMonths = (branchList) => {
			const agg = Object.fromEntries(
				this.months.map((m) => [m.key, { target: 0, achievement: 0, percentage: 0, branches: 0 }]),
			);
			branchList.forEach((b) => {
				this.months.forEach((m) => {
					const md = b.months[m.key];
					if (md) {
						agg[m.key].target += md.target || 0;
						agg[m.key].achievement += md.achievement || 0;
					}
				});
			});
			agg[this.months[0].key].branches = branchList.length;
			this.months.forEach((m) => {
				const ma = agg[m.key];
				ma.percentage = ma.target > 0 ? (ma.achievement / ma.target) * 100 : 0;
			});
			return agg;
		};

		sortedZoneNames.forEach((zoneName) => {
			const zoneGroup = groupedData[zoneName];

			const zoneAgg = {
				zone: zoneName,
				region: zoneName,
				months: aggregateMonths(zoneGroup.totalBranches),
				isZoneTotal: true,
			};
			result.push(zoneAgg);

			const sortedRegionNames = Object.keys(zoneGroup.regionBranches).sort();
			sortedRegionNames.forEach((regionName) => {
				const regionGroup = zoneGroup.regionBranches[regionName];

				const regionAgg = {
					zone: zoneName,
					region: regionName,
					months: aggregateMonths(regionGroup.branches),
					isZoneTotal: false,
					isRegionTotal: true,
				};
				result.push(regionAgg);

				const sortedDistrictNames = Object.keys(regionGroup.districts).sort();
				sortedDistrictNames.forEach((districtName) => {
					const districtBranches = regionGroup.districts[districtName];
					result.push({
						zone: zoneName,
						region: regionName,
						district: districtName,
						months: aggregateMonths(districtBranches),
						isZoneTotal: false,
						isRegionTotal: false,
					});
				});
			});
		});

		return result;
	}

	reaggregateCategoryData(branches) {
		if (!branches || !this.months || this.months.length === 0) return [];

		const latestMonthKey = this.months[0].key;
		const aggregatedCategories = {};

		this.availableFilters.categories.forEach((cat) => {
			aggregatedCategories[cat] = {
				category: cat,
				months: {
					[latestMonthKey]: {
						count: 0,
						changes: { increased: [], decreased: [] }, // No previous day data for reaggregation
						zone_breakdown: {},
					},
				},
			};
		});

		branches.forEach((branch) => {
			const monthData = branch.months[latestMonthKey];
			if (monthData && aggregatedCategories[monthData.category]) {
				const catAgg = aggregatedCategories[monthData.category].months[latestMonthKey];
				catAgg.count += 1;
				catAgg.zone_breakdown[branch.zone] = (catAgg.zone_breakdown[branch.zone] || 0) + 1;
			}
		});

		return Object.values(aggregatedCategories);
	}

	filterMovementData(changes) {
		if (!changes) return { increased: [], decreased: [] };

		let { increased, decreased } = changes;

		// Get a set of branch names that are in the current filtered view
		const filteredBranches = this.getFilteredBranches();
		const filteredBranchNames = new Set(filteredBranches.map((b) => b.branch));

		// Filter the increased and decreased arrays
		increased = increased.filter((item) => filteredBranchNames.has(item.branch));
		decreased = decreased.filter((item) => filteredBranchNames.has(item.branch));

		return { increased, decreased };
	}

	// ========================================================================
	// RENDERING - Main Render Function
	// ========================================================================
	render() {
		if (!this.data) {
			this.clearViewControlsHighlight();
			this.showError("No data available");
			return;
		}

		this.clearViewControlsHighlight();
		this.page.main.find("#error-message").hide();
		const dataContainer = this.page.main.find("#data-container");

		dataContainer.css("opacity", 0);

		const filteredBranches = this.getFilteredBranches();

		const reaggregatedZoneData = this.reaggregateZoneData(filteredBranches);
		const reaggregatedCategoryData = this.reaggregateCategoryData(filteredBranches);

		if (!this.months || this.months.length === 0) {
			this.page.main.find("#summary-cards-container").hide();
			this.highlightViewControls();
			this.showQuarterlyViewSuggestion();
			return;
		}

		this.page.main.find("#summary-cards-container").show();
		this.updateSummaryCards(filteredBranches, reaggregatedZoneData);

		setTimeout(() => {
			let htmlContent = "";

			if (this.state.activeTab === "zone") {
				htmlContent = this.renderZoneTable(reaggregatedZoneData);
			} else if (this.state.activeTab === "category") {
				htmlContent = this.renderCategoryTable(reaggregatedCategoryData);
			} else if (this.state.activeTab === "product") {
				const filteredProductData = this.getFilteredProductData();
				htmlContent = this.renderProductTable(filteredProductData);
			} else if (this.state.activeTab === "agent") {
				htmlContent = this.renderAgentWiseTable(this.agentData);
			} else if (this.state.activeTab === "branch") {
				htmlContent = this.buildBranchTable(filteredBranches, this.months);
			} else if (this.state.activeTab === "product_tgt_ach") {
				htmlContent = this.renderProductWiseTgtVsAchTable(filteredBranches);
			}

			dataContainer.html(htmlContent);

			// Attach handlers after rendering

			if (this.state.activeTab === "zone") {
				this.attachZoneExpandHandlers();
				this.attachZoneDrilldownHandlers();
			} else if (this.state.activeTab === "product") {
				this.attachProductExpandHandlers();
				this.attachProductDrilldownHandlers();
			} else if (this.state.activeTab === "category") {
				this.attachMovementPopupHandlers();
				this.attachCategoryExpandHandlers();
				this.attachDrillHandlers();
				this.attachZoneDrillHandlers();
				this.attachTotalMovementPopupHandler();
			} else if (this.state.activeTab === "agent") {
				this.attachAgentExpandHandlers();
			} else if (this.state.activeTab === "product_tgt_ach") {
				this.attachProductTgtAchExpandHandlers();
			}


			dataContainer.css("opacity", 1);
		}, 200);
	}

	// ========================================================================

	// ZONE WISE VIEW - Expandable/Collapsible

	// ========================================================================

	renderZoneTable(zoneData) {
		const months = this.months;

		let html = `
			<div style="overflow-x: auto; max-height: 75vh; overflow-y: auto;">
			    <table class="table table-bordered zone-wise-table" style="min-width: 100%; border-collapse: separate; border-spacing: 0;">
			        <thead style="position: sticky; top: 0; z-index: 20; background: white;">
			            <tr class="zone-table-header">
			                <th rowspan="2" style="text-align: center; width: 40px;"><input type="checkbox" class="zone-check-all" style="cursor: pointer;"></th>
			                <th rowspan="2" class="sr-col" style="width: 40px;">Sr</th>
			                <th rowspan="2" class="zone-col" style="text-align: left;">Z/R/DIS</th>
			                <th rowspan="2" class="branches-col">Branches</th>
			    `;

		const today = new Date();
		const currentMonth = today.getMonth();
		const currentYear = today.getFullYear();

		months.forEach((month) => {
			const monthDate = new Date(month.date);
			const monthIndex = monthDate.getMonth();
			const monthYear = monthDate.getFullYear();

			const monthName = month.display.split("-")[0];
			const displayYear = `${monthName}-${monthYear}`;

			let daysLeftIndicator = "";
			let highlightStyle = "";
			if (monthIndex === currentMonth && monthYear === currentYear) {
				const currentDay = today.getDate();
				const remainingDays = getRemainingWorkingDaysExcludingSundays(
					currentYear,
					currentMonth,
					currentDay,
				);

				if (remainingDays >= 0) {
					daysLeftIndicator = `
						<br>
						<span class="days-left-indicator">
							${remainingDays} Working Day${remainingDays !== 1 ? "s" : ""} Left
						</span>
					`;
				}
				highlightStyle = `background: #6ca8ac !important; color: #ffffff !important; border-bottom: 2px solid #558a8e !important;`;
			}

			const thStyle = highlightStyle ? "background: #6ca8ac !important; color: #ffffff !important; border-bottom: 2px solid #558a8e !important;" : "background: white; color: #1b263b;";
			html += `<th colspan="5" style="${thStyle}">${displayYear}${daysLeftIndicator}</th>`;
		});

		html += '</tr><tr class="zone-table-subheader">';

		months.forEach(() => {
			html += "<th style=\"background: white; color: #1b263b;\">Target</th><th style=\"background: white; color: #1b263b;\">Ach</th><th style=\"background: white; color: #1b263b;\">ACH %</th><th style=\"background: white; color: #1b263b;\">Ach Gap</th><th style=\"background: white; color: #1b263b;\">Ach Gap %</th>";
		});

		html += "</tr></thead><tbody>";

		const styleId = "days-left-indicator-style";
		if (!document.getElementById(styleId)) {
			const style = document.createElement("style");
			style.id = styleId;
			style.innerHTML = `
                @keyframes smooth-blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.75; }
                }
                .days-left-indicator {
                    display: inline-block;
                    background-color: #fef08a !important;
                    color: #854d0e !important;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-weight: 700;
                    animation: smooth-blink 1.8s ease-in-out infinite;
                    font-size: 10px;
                    margin-top: 4px;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
                }
                .zone-table-row td { background: inherit; }
                .zone-total-row td { background: #e0e1dd; }
                .zone-total-row td.sr-col,
                .zone-total-row td.zone-col,
                .zone-total-row td.branches-col { background: inherit; }
                .zone-table-row:hover td { background-color: #e8f4f8 !important; }
                .zone-table-row.checked td { background-color: #c8e6c9 !important; }
                .zone-table-row.checked:hover td { background-color: #b8d9b9 !important; }
                .region-detail-row td { background: inherit; }
                .region-detail-row:hover td { background-color: #e8f4f8 !important; }
                .region-detail-row.checked td { background-color: #c8e6c9 !important; }
                .region-detail-row.checked:hover td { background-color: #b8d9b9 !important; }
                .district-detail-row td { background: inherit; }
                .district-detail-row:hover td { background-color: #e8f4f8 !important; }
                .district-detail-row.checked td { background-color: #c8e6c9 !important; }
                .district-detail-row.checked:hover td { background-color: #b8d9b9 !important; }
                .zone-wise-table thead th { background: white; }
                .zone-wise-table tfoot td { position: sticky; bottom: 0; z-index: 9; }
            `;
			document.head.appendChild(style);
		}

		const grandTotals = {
			branches: 0,
		};
		months.forEach((month) => {
			grandTotals[month.key] = { target: 0, achievement: 0 };
		});

		// Accumulate grand totals only from zone total items (isZoneTotal === true)
		zoneData.forEach((item) => {
			if (item.isZoneTotal) {
				const firstMonthData = item.months[months[0].key];
				grandTotals.branches += firstMonthData?.branches || 0;

				months.forEach((month) => {
					const mdata = item.months[month.key];
					if (mdata) {
						grandTotals[month.key].target += mdata.target || 0;
						grandTotals[month.key].achievement += mdata.achievement || 0;
					}
				});
			}
		});

		// Group data by zone → region (with districts)
		const zoneGroups = {};

		zoneData.forEach((item) => {
			if (item.isZoneTotal) {
				if (!zoneGroups[item.zone]) {
					zoneGroups[item.zone] = { total: item, regionItems: {} };
				} else {
					zoneGroups[item.zone].total = item;
				}
			} else if (item.isRegionTotal) {
				if (!zoneGroups[item.zone]) {
					zoneGroups[item.zone] = { total: null, regionItems: {} };
				}
				if (!zoneGroups[item.zone].regionItems[item.region]) {
					zoneGroups[item.zone].regionItems[item.region] = { total: item, districts: [] };
				} else {
					zoneGroups[item.zone].regionItems[item.region].total = item;
				}
			} else {
				// District item
				if (!zoneGroups[item.zone]) {
					zoneGroups[item.zone] = { total: null, regionItems: {} };
				}
				if (!zoneGroups[item.zone].regionItems[item.region]) {
					zoneGroups[item.zone].regionItems[item.region] = { total: null, districts: [] };
				}
				zoneGroups[item.zone].regionItems[item.region].districts.push(item);
			}
		});

		let sr = 1;

		// Sort by zone name then regions
		Object.keys(zoneGroups)
			.sort((a, b) => {
				const aNum = a.match(/ZONE-(\d+)/)?.[1];
				const bNum = b.match(/ZONE-(\d+)/)?.[1];
				return aNum && bNum ? parseInt(aNum) - parseInt(bNum) : a.localeCompare(b);
			})
			.forEach((zoneName) => {
				const zoneGroup = zoneGroups[zoneName];

				const isZoneExpanded = this.state.expandedZones[zoneName] || false;

				// Zone Total Row
				if (zoneGroup.total) {
					html += this.buildZoneRow(zoneGroup.total, sr++, zoneName, isZoneExpanded);
				}

				// Region and District Rows
				Object.keys(zoneGroup.regionItems).sort().forEach((regionName) => {
					const regionGroup = zoneGroup.regionItems[regionName];
					const regionKey = zoneName + "::" + regionName;
					const isRegionExpanded = this.state.expandedZoneRegions[regionKey] || false;

					// Region Row
					if (regionGroup.total) {
						html += this.buildRegionRow(regionGroup.total, zoneName, isZoneExpanded, regionKey, isRegionExpanded);
					}

					// District Rows (hidden unless region expanded)
					if (regionGroup.total) {
						regionGroup.districts.forEach((districtItem) => {
							html += this.buildDistrictRow(districtItem, zoneName, isZoneExpanded, isRegionExpanded);
						});
					}
				});
			});

		html += "</tbody>";

		// Grand Total Row (Sticky Vertically and Horizontally)
		html += `<tfoot style="color: #ffffff; font-weight: bold; border-top: 2px solid #3d7579;">`;
		html += `<tr style="height: 40px;">`;
		html += `<td colspan="3" style="position: sticky; left: 0; bottom: 0; z-index: 9; background-color: #264a4d !important; color: #ffffff !important; text-align: left; padding-left: 12px; text-transform: uppercase; letter-spacing: 1px; border-right: none !important; box-shadow: inset -1px 0 0 #3d7579 !important;">TOTAL</td>`;
		html += `<td class="branches-col" style="position: sticky; left: 230px; bottom: 0; z-index: 9; background-color: #264a4d !important; color: #ffffff !important; text-align: center; border-right: none !important; box-shadow: inset -2px 0 0 #3d7579 !important;">${grandTotals.branches}</td>`;

		months.forEach((month) => {
			const totalTarget = grandTotals[month.key].target;
			const totalAchievement = grandTotals[month.key].achievement;
			const overallPercentage = totalTarget > 0 ? (totalAchievement / totalTarget) * 100 : 0;
			const totalGap = Math.max(0, totalTarget - totalAchievement);
			const totalGapPct = totalTarget > 0 ? (totalGap / totalTarget) * 100 : 0;

			const monthDate = new Date(month.date);
			const monthIndex = monthDate.getMonth();
			const monthYear = monthDate.getFullYear();
			const isCurrentMonth = monthIndex === currentMonth && monthYear === currentYear;

			const cellBg = isCurrentMonth ? "#6ca8ac !important" : "#264a4d !important";

			html += `
                 <td style="position: sticky; bottom: 0; z-index: 7; background-color: ${cellBg}; color: #ffffff !important;">${this.formatNumber(totalTarget)}</td>
                 <td style="position: sticky; bottom: 0; z-index: 7; background-color: ${cellBg}; color: #ffffff !important;">${this.formatNumber(totalAchievement)}</td>
                 <td style="position: sticky; bottom: 0; z-index: 7; background-color: ${cellBg}; color: #ffffff !important;">
 					<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
 						<span class="pct-value" style="color: ${isCurrentMonth ? "#ffffff !important" : this.getPctColor(overallPercentage)}; min-width: 45px; text-align: right; font-weight: bold;">${Math.round(overallPercentage)}%</span>
 						${this.renderProgressBar(overallPercentage)}
 					</div>
 				</td>
                 <td style="position: sticky; bottom: 0; z-index: 7; background-color: ${cellBg}; color: #ffffff !important;">${this.formatNumber(totalGap)}</td>
                 <td style="position: sticky; bottom: 0; z-index: 7; background-color: ${cellBg}; color: #ffffff !important;">
 					<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
 						<span class="pct-value" style="color: ${isCurrentMonth ? "#ffffff !important" : this.getPctColor(100 - totalGapPct)}; min-width: 45px; text-align: right; font-weight: bold;">${Math.round(totalGapPct)}%</span>
 						${this.renderProgressBar(totalGapPct, this.getPctColor(100 - totalGapPct))}
 					</div>
 				</td>
            `;
		});
		html += `</tr></tfoot>`;

		html += "</table></div>";

		return html;
	}

	buildZoneRow(zoneItem, sr, zoneName, isExpanded) {
		const months = this.months;
		const checked = this.state.checkedZoneRows["zone::" + zoneName] ? ' checked' : '';

		const firstMonthData = zoneItem.months[months[0].key];

		const branchCount = firstMonthData?.branches || 0;

		let html = `<tr class="zone-total-row zone-table-row${checked}" data-zone="${zoneName}" style="font-weight: bold; cursor: pointer;">`;
		html += `<td style="text-align: center;"><input type="checkbox" class="zone-row-check" data-check-id="zone::${zoneName}"${checked} style="cursor: pointer;"></td>`;
		html += `<td class="sr-col">${sr}</td>`;
		html += `<td class="zone-col"><span class="zone-toggle">${isExpanded ? "▼" : "▶"}</span> ${zoneName}</td>`;
		html += `<td class="branches-col branch-drilldown" data-zone="${zoneName}" title="Click to view branches in ${zoneName}">${branchCount}</td>`;

		months.forEach((month) => {
			const mdata = zoneItem.months[month.key];

			if (mdata) {
				const gapVal = Math.max(0, (mdata.target || 0) - (mdata.achievement || 0));
				const gapPct = (mdata.target || 0) > 0 ? (gapVal / mdata.target) * 100 : 0;
				html += `
			                <td>${this.formatNumber(mdata.target)}</td>
			                <td>${this.formatNumber(mdata.achievement)}</td>
			                <td>
								<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
									<span class="pct-value" style="color: ${this.getPctColor(
										mdata.percentage,
									)}; min-width: 45px; text-align: right;">${Math.round(mdata.percentage)}%</span>
									${this.renderProgressBar(mdata.percentage)}
								</div>
							</td>
			                <td>${this.formatNumber(gapVal)}</td>
			                <td>
								<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
									<span class="pct-value" style="color: ${this.getPctColor(
										100 - gapPct,
									)}; min-width: 45px; text-align: right;">${Math.round(gapPct)}%</span>
									${this.renderProgressBar(gapPct, this.getPctColor(100 - gapPct))}
								</div>
							</td>
			            `;
			} else {
				html += "<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>";
			}
		});

		return html + "</tr>";
	}

	buildRegionRow(regionItem, zoneName, isZoneExpanded, regionKey, isRegionExpanded) {
		const months = this.months;
		const checked = this.state.checkedZoneRows[regionKey] ? ' checked' : '';

		const firstMonthData = regionItem.months[months[0].key];

		const branchCount = firstMonthData?.branches || 0;

		let html = `<tr class="region-detail-row zone-table-row${checked}" data-zone="${zoneName}" data-region="${regionItem.region}" data-region-key="${regionKey}" style="display: ${
			isZoneExpanded ? "table-row" : "none"
		}; border-left: 4px solid #417d81; cursor: pointer;">`;

		html += `<td style="text-align: center;"><input type="checkbox" class="zone-row-check" data-check-id="${regionKey}"${checked} style="cursor: pointer;"></td>`;
		html += `<td class="sr-col"></td>`;
		html += `<td class="zone-col" style="padding-left: 30px;"><span class="region-toggle" style="margin-right: 4px;">${isRegionExpanded ? "▼" : "▶"}</span> ${regionItem.region}</td>`;
		html += `<td class="branches-col branch-drilldown" data-zone="${zoneName}" data-region="${regionItem.region}" title="Click to view branches in ${regionItem.region}">${branchCount}</td>`;

		months.forEach((month) => {
			const mdata = regionItem.months[month.key];

			if (mdata) {
				const gapVal = Math.max(0, (mdata.target || 0) - (mdata.achievement || 0));
				const gapPct = (mdata.target || 0) > 0 ? (gapVal / mdata.target) * 100 : 0;
				html += `
			                <td>${this.formatNumber(mdata.target)}</td>
			                <td>${this.formatNumber(mdata.achievement)}</td>
			                <td>
								<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
									<span class="pct-value" style="color: ${this.getPctColor(
										mdata.percentage,
									)}; min-width: 45px; text-align: right;">${Math.round(mdata.percentage)}%</span>
									${this.renderProgressBar(mdata.percentage)}
								</div>
							</td>
			                <td>${this.formatNumber(gapVal)}</td>
			                <td>
								<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
									<span class="pct-value" style="color: ${this.getPctColor(
										100 - gapPct,
									)}; min-width: 45px; text-align: right;">${Math.round(gapPct)}%</span>
									${this.renderProgressBar(gapPct, this.getPctColor(100 - gapPct))}
								</div>
							</td>
			            `;
			} else {
				html += "<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>";
			}
		});

		return html + "</tr>";
	}

	buildDistrictRow(districtItem, zoneName, isZoneExpanded, isRegionExpanded) {
		const months = this.months;
		const districtKey = zoneName + "::" + districtItem.region + "::" + districtItem.district;
		const checked = this.state.checkedZoneRows[districtKey] ? ' checked' : '';

		const firstMonthData = districtItem.months[months[0].key];

		const branchCount = firstMonthData?.branches || 0;

		let html = `<tr class="district-detail-row zone-table-row${checked}" data-zone="${zoneName}" data-region="${districtItem.region}" data-district="${districtItem.district}" data-district-key="${districtKey}" style="display: ${
			isZoneExpanded && isRegionExpanded ? "table-row" : "none"
		};">`;

		html += `<td style="text-align: center;"><input type="checkbox" class="zone-row-check" data-check-id="${districtKey}"${checked} style="cursor: pointer;"></td>`;
		html += `<td class="sr-col"></td>`;
		html += `<td class="zone-col" style="padding-left: 60px;">${districtItem.district}</td>`;
		html += `<td class="branches-col branch-drilldown" data-zone="${zoneName}" data-region="${districtItem.region}" data-district="${districtItem.district}" title="Click to view branches in ${districtItem.district}">${branchCount}</td>`;

		months.forEach((month) => {
			const mdata = districtItem.months[month.key];

			if (mdata) {
				const gapVal = Math.max(0, (mdata.target || 0) - (mdata.achievement || 0));
				const gapPct = (mdata.target || 0) > 0 ? (gapVal / mdata.target) * 100 : 0;
				html += `
			                <td>${this.formatNumber(mdata.target)}</td>
			                <td>${this.formatNumber(mdata.achievement)}</td>
			                <td>
								<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
									<span class="pct-value" style="color: ${this.getPctColor(
										mdata.percentage,
									)}; min-width: 45px; text-align: right;">${Math.round(mdata.percentage)}%</span>
									${this.renderProgressBar(mdata.percentage)}
								</div>
							</td>
			                <td>${this.formatNumber(gapVal)}</td>
			                <td>
								<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
									<span class="pct-value" style="color: ${this.getPctColor(
										100 - gapPct,
									)}; min-width: 45px; text-align: right;">${Math.round(gapPct)}%</span>
									${this.renderProgressBar(gapPct, this.getPctColor(100 - gapPct))}
								</div>
							</td>
			            `;
			} else {
				html += "<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>";
			}
		});

		return html + "</tr>";
	}

	attachZoneExpandHandlers() {
		const self = this;

		this.page.main

			.find(".zone-total-row")

			.off("click")

			.on("click", function (e) {
				if ($(e.target).is("input[type=checkbox]") || $(e.target).closest("input[type=checkbox]").length) return;
				const zoneName = $(this).data("zone");

				self.state.expandedZones[zoneName] = !self.state.expandedZones[zoneName];

				self.render();
			});

		this.page.main

			.find(".zone-row-check")

			.off("click")

			.on("click", function (e) {
				e.stopPropagation();
				const checkId = $(this).data("check-id");
				const checked = $(this).prop("checked");

				if (checked) {
					self.state.checkedZoneRows[checkId] = true;
				} else {
					delete self.state.checkedZoneRows[checkId];
				}

				self.render();
			});

		this.page.main

			.find(".zone-check-all")

			.off("click")

			.on("click", function () {
				const checked = $(this).prop("checked");
				self.state.checkedZoneRows = {};
				if (checked) {
					// Check all visible rows
					self.page.main.find(".zone-table-row:visible").each(function () {
						const cb = $(this).find(".zone-row-check");
						if (cb.length) {
							self.state.checkedZoneRows[cb.data("check-id")] = true;
						}
					});
				}
				self.render();
			});

		this.page.main

			.find(".region-detail-row")

			.off("click")

			.on("click", function (e) {
				if ($(e.target).is("input[type=checkbox]") || $(e.target).closest("input[type=checkbox]").length) return;
				const regionKey = $(this).data("region-key");
				if (!regionKey) return;

				self.state.expandedZoneRegions[regionKey] = !self.state.expandedZoneRegions[regionKey];

				self.render();
			});
	}

	// ========================================================================
	// PRODUCT WISE VIEW - Zone/Region Summary
	// ========================================================================

	renderProductTable(productData) {
		if (!productData || productData.length === 0) {
			return `
				<div style="text-align: center; padding: 50px; color: #778da9; font-size: 16px;">
					<div style="font-size: 48px; margin-bottom: 15px;">📭</div>
					<div style="font-weight: 600; margin-bottom: 8px;">No product data available</div>
				</div>
			`;
		}

		const allProducts = this.allProducts.filter(p => p !== "TDA" && p !== "SHARE");

		let headerHtml = `
			<style>
				.product-wise-table tbody tr:hover { background-color: #e8f4f8 !important; cursor: pointer; }
				.product-wise-table tbody tr.checked-row { background-color: #c8e6c9 !important; }
				.product-wise-table tbody tr.checked-row:hover { background-color: #a5d6a7 !important; }
				.product-wise-table .row-checkbox { width: 32px; text-align: center; vertical-align: middle; }
				.product-wise-table .row-checkbox input { cursor: pointer; width: 15px; height: 15px; accent-color: #417d81; }
			</style>
			<table class="table table-bordered product-wise-table">
				<thead>
					<tr class="zone-table-header">
						<th rowspan="2" style="width:32px;" class="row-checkbox"></th>
						<th rowspan="2" style="width:60px;">SR</th>
						<th rowspan="2" style="text-align: left;">Z/R/DIS/SOL</th>
		`;

		allProducts.forEach((product) => {
			headerHtml += `<th>${product}</th>`;
		});

		headerHtml += `
						<th rowspan="2" style="width:140px;">ACHIEVEMENT</th>
					</tr>
				</thead>
				<tbody>
		`;

		let html = headerHtml;

		let sr = 1;
		let grandTotal = 0;
		let productTotals = {};

		allProducts.forEach((product) => {
			productTotals[product] = 0;
		});

		productData.forEach((item) => {
			const products = item.products || {};
			const isExpanded = this.state.expandedProductRows[item.path] || false;
			const checked = this.state.checkedProductRows && this.state.checkedProductRows[item.path] ? ' checked' : '';
			const checkedClass = checked ? ' checked-row' : '';
			const rowAchievement = allProducts.reduce((sum, product) => sum + (products[product] || 0), 0);

			if (item.type === "zone") {
				html += `
					<tr class="zone-total-row product-total-row${checkedClass}" data-path="${item.path}" style="background-color: #e0e1dd; font-weight: bold; cursor: pointer;">
						<td class="row-checkbox"><input type="checkbox" class="product-row-checkbox" data-path="${item.path}"${checked}></td>
						<td>${sr++}</td>
						<td style="text-align: left; padding-left: 8px;">
							<span class="product-toggle" style="margin-right: 6px; font-size: 10px;">${isExpanded ? "▼" : "▶"}</span>
							<strong>${item.name}</strong>
						</td>
				`;
				allProducts.forEach((product) => {
					const amount = products[product] || 0;
					productTotals[product] += amount;
					html += `<td>${this.formatCurrency(amount)}</td>`;
				});
				html += `<td>${this.formatCurrency(rowAchievement)}</td></tr>`;
				grandTotal += rowAchievement;
			} else if (item.type === "region") {
				const parentExpanded = this.state.expandedProductRows[item.parent_zone] || false;
				const show = parentExpanded;
				html += `
					<tr class="product-detail-row${checkedClass}" data-path="${item.path}" data-parent="${item.parent_zone}" style="display: ${show ? "table-row" : "none"}; background-color: #f8fafc; font-weight: bold; cursor: pointer; border-left: 4px solid #417d81;">
						<td class="row-checkbox"><input type="checkbox" class="product-row-checkbox" data-path="${item.path}"${checked}></td>
						<td></td>
						<td style="text-align: left; padding-left: 28px; color: #097c80;">
							<span class="product-toggle" style="margin-right: 6px; font-size: 10px;">${isExpanded ? "▼" : "▶"}</span>
							<strong>${item.name}</strong>
						</td>
				`;
				allProducts.forEach((product) => {
					const amount = products[product] || 0;
					html += `<td>${this.formatCurrency(amount)}</td>`;
				});
				html += `<td>${this.formatCurrency(rowAchievement)}</td></tr>`;
			} else if (item.type === "district") {
				const zoneExp = this.state.expandedProductRows[item.parent_zone] || false;
				const regionExp = this.state.expandedProductRows[item.parent_region] || false;
				const show = zoneExp && regionExp;
				html += `
					<tr class="product-detail-row${checkedClass}" data-path="${item.path}" data-parent="${item.parent_region}" style="display: ${show ? "table-row" : "none"}; background-color: #fafafa; font-weight: bold; cursor: pointer; border-left: 6px solid #64748b;">
						<td class="row-checkbox"><input type="checkbox" class="product-row-checkbox" data-path="${item.path}"${checked}></td>
						<td></td>
						<td style="text-align: left; padding-left: 48px; color: #1e293b;">
							<span class="product-toggle" style="margin-right: 6px; font-size: 10px;">${isExpanded ? "▼" : "▶"}</span>
							<strong>${item.name}</strong>
						</td>
				`;
				allProducts.forEach((product) => {
					const amount = products[product] || 0;
					html += `<td>${this.formatCurrency(amount)}</td>`;
				});
				html += `<td>${this.formatCurrency(rowAchievement)}</td></tr>`;
			} else if (item.type === "sol") {
				const zoneExp = this.state.expandedProductRows[item.parent_zone] || false;
				const regionExp = this.state.expandedProductRows[item.parent_region] || false;
				const districtExp = this.state.expandedProductRows[item.parent_district] || false;
				const show = zoneExp && regionExp && districtExp;
				html += `
					<tr class="product-detail-row${checkedClass}" style="display: ${show ? "table-row" : "none"}; background: #ffffff; border-left: 8px solid #cbd5e1;">
						<td class="row-checkbox"><input type="checkbox" class="product-row-checkbox" data-path="${item.path}"${checked}></td>
						<td></td>
						<td style="text-align: left; padding-left: 68px; color: #475569; font-weight: normal;">${item.name}</td>
				`;
				allProducts.forEach((product) => {
					const amount = products[product] || 0;
					html += `<td>${this.formatCurrency(amount)}</td>`;
				});
				html += `<td>${this.formatCurrency(rowAchievement)}</td></tr>`;
			}
		});

		html += `
			</tbody>
			<tfoot style="background-color: #264a4d; color: #ffffff; font-weight: bold; border-top: 2px solid #3d7579;">
				<tr style="height: 40px;">
					<td></td>
					<td colspan="2" style="text-align: left; padding-left: 12px; text-transform: uppercase; letter-spacing: 1px;">TOTAL</td>
		`;

		allProducts.forEach((product) => {
			html += `<td>${this.formatCurrency(productTotals[product])}</td>`;
		});

		html += `
					<td>${this.formatCurrency(grandTotal)}</td>
				</tr>
			</tfoot>
		</table>`;

		return html;
	}

	attachProductExpandHandlers() {
		const self = this;

		this.page.main.find(".product-row-checkbox").off("change").on("change", function (e) {
			e.stopPropagation();
			const path = $(this).data("path");
			const checked = $(this).prop("checked");
			if (!self.state.checkedProductRows) self.state.checkedProductRows = {};
			if (checked) {
				self.state.checkedProductRows[path] = true;
				$(this).closest("tr").addClass("checked-row");
			} else {
				delete self.state.checkedProductRows[path];
				$(this).closest("tr").removeClass("checked-row");
			}
		});

		this.page.main
			.find(".product-wise-table .product-total-row, .product-wise-table .product-detail-row")
			.off("click")
			.on("click", function (e) {
				if ($(e.target).is("input[type=checkbox]")) return;
				const path = $(this).data("path");
				if (path) {
					self.state.expandedProductRows[path] = !self.state.expandedProductRows[path];
					self.render();
				}
			});
	}

	attachProductDrilldownHandlers() {
		// No drilldown required for this view as per the new requirements.
	}

	// ========================================================================

	// AGENT WISE VIEW - Zone/Region Collapsible

	// ========================================================================

	renderAgentWiseTable(agentData) {
		if (!agentData || agentData.length === 0) {
			return `
				<div style="text-align: center; padding: 50px; color: #778da9; font-size: 16px;">
					<div style="font-size: 48px; margin-bottom: 15px;">📭</div>
					<div style="font-weight: 600; margin-bottom: 8px;">No agent data available</div>
				</div>
			`;
		}

		// Group by zone
		const grouped = {};
		agentData.forEach((row) => {
			if (!grouped[row.zone]) {
				grouped[row.zone] = [];
			}
			grouped[row.zone].push(row);
		});

		let sr = 1;
		let html = `
			<table class="agent-wise-table">
				<thead>
					<tr class="branch-table-header">
						<th rowspan="2" class="sr-col">SR</th>
						<th rowspan="2">ZONE / REGION</th>
						<th rowspan="2">SS TARGET</th>
						<th rowspan="2">SS ACHIEVEMENT</th>
						<th rowspan="2">SS SHORTFALL</th>
						<th rowspan="2">SS ACTIVE</th>
						<th rowspan="2">SS INACTIVE</th>
						<th rowspan="2">SS Ach %</th>
						<th rowspan="2">VS TARGET</th>
						<th rowspan="2">VS ACHIEVEMENT</th>
						<th rowspan="2">VS SHORTFALL</th>
						<th rowspan="2">VS ACTIVE</th>
						<th rowspan="2">VS INACTIVE</th>
						<th rowspan="2">VS Ach %</th>
					</tr>
					<tr class="branch-table-subheader">
					</tr>
				</thead>
				<tbody>
		`;

		// Sort zones
		const sortedZones = Object.keys(grouped).sort((a, b) => {
			const aNum = a.match(/ZONE-(\d+)/)?.[1];
			const bNum = b.match(/ZONE-(\d+)/)?.[1];
			return aNum && bNum ? parseInt(aNum) - parseInt(bNum) : a.localeCompare(b);
		});

		sortedZones.forEach((zone) => {
			const zoneRows = grouped[zone];

			// Calculate zone totals
			let zoneTarget = 0;
			let zoneAch = 0;
			let zoneSsTarget = 0;
			let zoneSsAch = 0;
			let zoneSsActive = 0;
			let zoneSsInactive = 0;
			let zoneActive = 0;
			let zoneInactive = 0;

			zoneRows.forEach((r) => {
				zoneTarget += parseFloat(r.target || 0);
				zoneAch += parseFloat(r.achievement || 0);
				zoneSsTarget += parseFloat(r.ss_target || 0);
				zoneSsAch += parseFloat(r.ss_achievement || 0);
				zoneSsActive += parseFloat(r.ss_active || 0);
				zoneSsInactive += parseFloat(r.ss_inactive || 0);
				zoneActive += parseFloat(r.active || 0);
				zoneInactive += parseFloat(r.inactive || 0);
			});

			const zoneSsShortfallRaw = zoneSsTarget - zoneSsAch;
			const zoneAgentShortfallRaw = zoneTarget - zoneAch;
			const zoneSsShortfall = Math.abs(zoneSsShortfallRaw);
			const zoneAgentShortfall = Math.abs(zoneAgentShortfallRaw);
			const zoneSsPercent = zoneSsTarget > 0 ? ((zoneSsAch / zoneSsTarget) * 100).toFixed(2) : 0;
			const zonePercent = zoneTarget > 0 ? ((zoneAch / zoneTarget) * 100).toFixed(2) : 0;
			const isExpanded = this.state.expandedZones[`agent_${zone}`] || false;
			const zoneDate =
				zoneRows[0]?.date || this.state.selectedDate || frappe.datetime.get_today();

			// Zone row
			html += `
				<tr class="agent-zone-row branch-table-row" data-zone="${zone}" data-date="${zoneDate}" style="background: #f8fafc; cursor: pointer;">
					<td class="sr-col">${sr++}</td>
					<td>
						<div class="branch-info" style="white-space: nowrap;">
							<div class="branch-code-name">
								<span class="agent-toggle" style="display: inline-block; width: 20px; margin-right: 8px; cursor: pointer;">${isExpanded ? "▼" : "▶"}</span>
								<strong style="vertical-align: middle;">${zone}</strong>
							</div>
						</div>
					</td>
					<td class="metric-cell amount-cell">${this.formatCurrency(zoneSsTarget)}</td>
					<td class="metric-cell amount-cell">${this.formatCurrency(zoneSsAch)}</td>
					<td class="metric-cell amount-cell" style="color: ${zoneSsShortfallRaw > 0 ? "#ef4444" : "#10b981"}; font-weight: 600;">${this.formatCurrency(zoneSsShortfall)}</td>
					<td class="metric-cell amount-cell">${this.formatNumber(zoneSsActive)}</td>
					<td class="metric-cell amount-cell">${this.formatNumber(zoneSsInactive)}</td>
					<td>
						<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
							<span class="pct-value" style="color: ${this.getPctColor(zoneSsPercent)}; min-width: 45px; text-align: right;">${Math.round(zoneSsPercent)}%</span>
							${this.renderProgressBar(zoneSsPercent)}
						</div>
					</td>
					<td class="metric-cell amount-cell">${this.formatCurrency(zoneTarget)}</td>
					<td class="metric-cell amount-cell">${this.formatCurrency(zoneAch)}</td>
					<td class="metric-cell amount-cell" style="color: ${zoneAgentShortfallRaw > 0 ? "#ef4444" : "#10b981"}; font-weight: 600;">${this.formatCurrency(zoneAgentShortfall)}</td>
					<td class="metric-cell amount-cell">${this.formatNumber(zoneActive)}</td>
					<td class="metric-cell amount-cell">${this.formatNumber(zoneInactive)}</td>
					<td>
						<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
							<span class="pct-value" style="color: ${this.getPctColor(zonePercent)}; min-width: 45px; text-align: right;">${Math.round(zonePercent)}%</span>
							${this.renderProgressBar(zonePercent)}
						</div>
					</td>
				</tr>
			`;

			// Sort regions within the zone
			const sortedRegionRows = zoneRows.sort((a, b) => {
				const aNum = a.region.match(/REGION-(\d+)/)?.[1];
				const bNum = b.region.match(/REGION-(\d+)/)?.[1];
				return aNum && bNum
					? parseInt(aNum) - parseInt(bNum)
					: a.region.localeCompare(b.region);
			});

			// Region rows (hidden by default)
			sortedRegionRows.forEach((r) => {
				const rSsTarget = parseFloat(r.ss_target || 0);
				const rSsAch = parseFloat(r.ss_achievement || 0);
				const rTarget = parseFloat(r.target || 0);
				const rAch = parseFloat(r.achievement || 0);
				const rSsActive = parseFloat(r.ss_active || 0);
				const rSsInactive = parseFloat(r.ss_inactive || 0);
				const rActive = parseFloat(r.active || 0);
				const rInactive = parseFloat(r.inactive || 0);
				const rDate = r.date || zoneDate;

				const rSsShortfallRaw = rSsTarget - rSsAch;
				const rAgentShortfallRaw = rTarget - rAch;
				const rSsShortfall = Math.abs(rSsShortfallRaw);
				const rAgentShortfall = Math.abs(rAgentShortfallRaw);
				const rSsPercent = rSsTarget > 0 ? ((rSsAch / rSsTarget) * 100).toFixed(2) : 0;
				const rPercent = rTarget > 0 ? ((rAch / rTarget) * 100).toFixed(2) : 0;

				html += `
					<tr class="agent-region-row region-of-${zone} branch-table-row" data-region="${r.region}" data-date="${rDate}" style="display: ${isExpanded ? "table-row" : "none"}; background: #ffffff; cursor: pointer;">
						<td class="sr-col"></td>
						<td>
							<div class="branch-info" style="white-space: nowrap;">
								<div class="branch-code-name">
									<span style="display: inline-block; width: 20px; margin-right: 8px;"></span>
									<span style="padding-left: 40px; color: #097c80; font-weight: 500;">${r.region}</span>
								</div>
							</div>
						</td>
						<td class="metric-cell amount-cell">${this.formatCurrency(rSsTarget)}</td>
						<td class="metric-cell amount-cell">${this.formatCurrency(rSsAch)}</td>
						<td class="metric-cell amount-cell" style="color: ${rSsShortfallRaw > 0 ? "#ef4444" : "#10b981"}; font-weight: 600;">${this.formatCurrency(rSsShortfall)}</td>
						<td class="metric-cell amount-cell">${this.formatNumber(rSsActive)}</td>
						<td class="metric-cell amount-cell">${this.formatNumber(rSsInactive)}</td>
						<td>
							<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
								<span class="pct-value" style="color: ${this.getPctColor(rSsPercent)}; min-width: 45px; text-align: right;">${Math.round(rSsPercent)}%</span>
								${this.renderProgressBar(rSsPercent)}
							</div>
						</td>
						<td class="metric-cell amount-cell">${this.formatCurrency(rTarget)}</td>
						<td class="metric-cell amount-cell">${this.formatCurrency(rAch)}</td>
						<td class="metric-cell amount-cell" style="color: ${rAgentShortfallRaw > 0 ? "#ef4444" : "#10b981"}; font-weight: 600;">${this.formatCurrency(rAgentShortfall)}</td>
						<td class="metric-cell amount-cell">${this.formatNumber(rActive)}</td>
						<td class="metric-cell amount-cell">${this.formatNumber(rInactive)}</td>
						<td>
							<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
								<span class="pct-value" style="color: ${this.getPctColor(rPercent)}; min-width: 45px; text-align: right;">${Math.round(rPercent)}%</span>
								${this.renderProgressBar(rPercent)}
							</div>
						</td>
					</tr>
				`;
			});
		});

		// Calculate overall grand totals across all agent data
		let totalSsTarget = 0;
		let totalSsAch = 0;
		let totalSsActive = 0;
		let totalSsInactive = 0;
		let totalVsTarget = 0;
		let totalVsAch = 0;
		let totalVsActive = 0;
		let totalVsInactive = 0;

		agentData.forEach((r) => {
			totalSsTarget += parseFloat(r.ss_target || 0);
			totalSsAch += parseFloat(r.ss_achievement || 0);
			totalSsActive += parseFloat(r.ss_active || 0);
			totalSsInactive += parseFloat(r.ss_inactive || 0);
			totalVsTarget += parseFloat(r.target || 0);
			totalVsAch += parseFloat(r.achievement || 0);
			totalVsActive += parseFloat(r.active || 0);
			totalVsInactive += parseFloat(r.inactive || 0);
		});

		const totalSsShortfallRaw = totalSsTarget - totalSsAch;
		const totalVsShortfallRaw = totalVsTarget - totalVsAch;
		const totalSsShortfall = Math.abs(totalSsShortfallRaw);
		const totalVsShortfall = Math.abs(totalVsShortfallRaw);
		const totalSsPercent = totalSsTarget > 0 ? ((totalSsAch / totalSsTarget) * 100).toFixed(2) : 0;
		const totalVsPercent = totalVsTarget > 0 ? ((totalVsAch / totalVsTarget) * 100).toFixed(2) : 0;

		html += `
				</tbody>
				<tfoot style="background-color: #264a4d; color: #ffffff; font-weight: bold; border-top: 2px solid #3d7579;">
					<tr style="height: 40px;">
						<td></td>
						<td style="text-align: left; padding-left: 12px; text-transform: uppercase; letter-spacing: 1px;">TOTAL</td>
						<td class="metric-cell amount-cell" style="color: #ffffff;">${this.formatCurrency(totalSsTarget)}</td>
						<td class="metric-cell amount-cell" style="color: #ffffff;">${this.formatCurrency(totalSsAch)}</td>
						<td class="metric-cell amount-cell" style="color: ${totalSsShortfallRaw > 0 ? "#fca5a5" : "#6ee7b7"}; font-weight: 600;">${this.formatCurrency(totalSsShortfall)}</td>
						<td class="metric-cell amount-cell" style="color: #ffffff;">${this.formatNumber(totalSsActive)}</td>
						<td class="metric-cell amount-cell" style="color: #ffffff;">${this.formatNumber(totalSsInactive)}</td>
						<td>
							<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
								<span class="pct-value" style="color: #ffffff; min-width: 45px; text-align: right;">${Math.round(totalSsPercent)}%</span>
								${this.renderProgressBar(totalSsPercent)}
							</div>
						</td>
						<td class="metric-cell amount-cell" style="color: #ffffff;">${this.formatCurrency(totalVsTarget)}</td>
						<td class="metric-cell amount-cell" style="color: #ffffff;">${this.formatCurrency(totalVsAch)}</td>
						<td class="metric-cell amount-cell" style="color: ${totalVsShortfallRaw > 0 ? "#fca5a5" : "#6ee7b7"}; font-weight: 600;">${this.formatCurrency(totalVsShortfall)}</td>
						<td class="metric-cell amount-cell" style="color: #ffffff;">${this.formatNumber(totalVsActive)}</td>
						<td class="metric-cell amount-cell" style="color: #ffffff;">${this.formatNumber(totalVsInactive)}</td>
						<td>
							<div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
								<span class="pct-value" style="color: #ffffff; min-width: 45px; text-align: right;">${Math.round(totalVsPercent)}%</span>
								${this.renderProgressBar(totalVsPercent)}
							</div>
						</td>
					</tr>
				</tfoot>
			</table>
		`;
		return html;
	}

	/**
	 * Set date in the Date selector field when clicking Agent Wise rows
	 * Converts date to yyyy-mm-dd format for the date input field
	 * Only works in Agent Wise tab
	 */
	setAgentWiseDate(date_value) {
		if (!date_value) return;

		// Strip time portion if present (handle "2026-03-18 00:00:00" format)
		let clean_date = String(date_value).split(" ")[0];

		// Convert to date object and back to ensure valid format
		let d = frappe.datetime.str_to_obj(clean_date);
		let formatted_for_input = frappe.datetime.obj_to_str(d); // gives yyyy-mm-dd

		// Update the date control
		if (this.dateControl) {
			this.isRefreshingDate = true;
			this.dateControl.set_value(formatted_for_input);
			this.isRefreshingDate = false;
		}

		// Update state and tab-specific date storage
		this.state.selectedDate = formatted_for_input;
		this.tabDates["agent"] = formatted_for_input;

		// Reload data with new date
		this._dataLoaded = false;
		this.loadData();
	}

	attachAgentExpandHandlers() {
		const self = this;

		// Handle Zone Expand/Collapse and Date Sync
		this.page.main
			.find(".agent-zone-row")
			.off("click")
			.on("click", function () {
				const zone = $(this).data("zone");
				const rowDate = $(this).data("date");

				// Sync date to date selector (Agent Wise tab only)
				if (rowDate && self.state.activeTab === "agent") {
					self.setAgentWiseDate(rowDate);
				}

				// Toggle expanded state
				self.state.expandedZones[`agent_${zone}`] =
					!self.state.expandedZones[`agent_${zone}`];

				// Re-render to reflect changes
				self.render();
			});

		// Handle Region Row Click - Date Sync Only
		this.page.main
			.find(".agent-region-row")
			.off("click")
			.on("click", function () {
				const rowDate = $(this).data("date");

				// Sync date to date selector (Agent Wise tab only)
				if (rowDate && self.state.activeTab === "agent") {
					self.setAgentWiseDate(rowDate);
				}
			});
	}

	// ========================================================================

	// CATEGORY WISE VIEW - With Zone Breakdown

	// ========================================================================

	renderCategoryTable(reaggregatedCategoryData) {
		const months = this.months;
		const latestMonthKey = months[0]?.key;
		if (!latestMonthKey) return "<div>No data available for the selected period.</div>";

		const categoryConfig = {
			Pinnacle: { grade: "A+", range: ">100%", color: "#6D28D9", health: "Excellent" },
			Master: { grade: "A", range: "80-100%", color: "#1D4ED8", health: "Good" },
			Accelerator: { grade: "B", range: "60-80%", color: "#047857", health: "Improving" },
			Starter: { grade: "C", range: "40-60%", color: "#B45309", health: "Needs Attention" },
			Learner: { grade: "D", range: "20-40%", color: "#BE185D", health: "At Risk" },
			"Zero Level": { grade: "E", range: "0-20%", color: "#991B1B", health: "Critical" },
		};
		const categoryOrder = Object.keys(categoryConfig);

		// Calculate Totals based on reaggregatedCategoryData
		let totalBranches = 0;
		reaggregatedCategoryData.forEach((catData) => {
			const monthData = catData.months[latestMonthKey];
			if (monthData) {
				totalBranches += monthData.count || 0;
			}
		});

		// Calculate total movements based on original data but filtered
		let totalIncreasedBranches = [];
		let totalDecreasedBranches = [];

		this.categoryData.forEach((catData) => {
			const monthData = catData.months[latestMonthKey];
			if (monthData && monthData.changes) {
				const filteredChanges = this.filterMovementData(monthData.changes);
				totalIncreasedBranches = totalIncreasedBranches.concat(filteredChanges.increased);
				totalDecreasedBranches = totalDecreasedBranches.concat(filteredChanges.decreased);
			}
		});
		const totalUp = totalIncreasedBranches.length;
		const totalDown = totalDecreasedBranches.length;

		let html = `
    <table class="table table-bordered category-table-redesigned">
        <thead>
            <tr>
                <th style="width: 25%;">Category</th>
                <th style="width: 15%;">Performance Band</th>
                <th style="width: 15%;">Branch Count</th>
                <th style="width: 20%;">Movement (vs Prev. Day)</th>
                <th style="width: 25%;">Health Status</th>
            </tr>
        </thead>
        <tbody>
    `;

		// Filter categories to display
		let categoriesToDisplay = categoryOrder;
		if (this.state.selectedCategories.length > 0) {
			categoriesToDisplay = categoryOrder.filter((c) =>
				this.state.selectedCategories.includes(c),
			);
		}

		categoriesToDisplay.forEach((catName) => {
			const config = categoryConfig[catName];
			// Find data for this specific category
			const reaggCatData = reaggregatedCategoryData.find((c) => c.category === catName);
			const originalCatData = this.categoryData.find((c) => c.category === catName);

			const monthData = reaggCatData?.months[latestMonthKey];
			const originalMonthData = originalCatData?.months[latestMonthKey];

			const count = monthData?.count || 0;

			// Get original changes and filter them based on current filters
			const originalChanges = originalMonthData?.changes || { increased: [], decreased: [] };
			const filteredChanges = this.filterMovementData(originalChanges);
			const upCount = filteredChanges.increased.length;
			const downCount = filteredChanges.decreased.length;

			const isExpanded = this.state.expandedZones[`cat_${catName}`] || false;
			const percentage = totalBranches > 0 ? (count / totalBranches) * 100 : 0;

			html += `
            <tr class="category-row-redesigned" data-category="${catName}" style="border-left: 5px solid ${
				config.color
			};">
                <td class="cat-name-cell" style="--fill-pct: ${percentage}%; --fill-color: ${config.color}26;">
                    <span class="category-toggle">${isExpanded ? "▼" : "▶"}</span>
                    <span class="cat-grade" style="background-color: ${config.color}; font-weight: 800;">${
						config.grade
					}</span>
                    <div class="cat-name-wrapper">
                        <span style="color: ${config.color}; font-weight: 700; font-size: 14px;">${catName}</span>
                        <span class="category-percentage-share" style="color: ${config.color}; font-weight: 700; opacity: 0.85;">• ${Math.round(percentage)}%</span>
                    </div>
                </td>
                <td class="perf-band-cell" style="color: ${config.color}; font-weight: 700;">${config.range}</td>
                <td class="count-cell drill-cell" data-category="${catName}" data-month="${latestMonthKey}">
                    <span class="drill-link" style="color: ${config.color}; font-weight: 800;">${count}</span>
                </td>
                <td class="movement-cell" data-changes='${JSON.stringify(filteredChanges)}'>
                    <div class="movement-summary">
                        ${upCount > 0 ? `<span class="mov-up">↑ ${upCount}</span>` : ""}
                        ${downCount > 0 ? `<span class="mov-down">↓ ${downCount}</span>` : ""}
                        ${
							upCount === 0 && downCount === 0
								? `<span class="mov-neutral">-</span>`
								: ""
						}
                    </div>
                </td>
                <td class="health-cell" style="color: ${config.color}; font-weight: 700;">
                    <span class="health-indicator" style="background-color: ${
						config.color
					}; box-shadow: 0 0 6px ${config.color}80;"></span>
                    ${config.health}
                </td>
            </tr>
        `;

			// Zone Breakdown Rows
			if (isExpanded) {
				html += `
                <tr class="zone-breakdown-row-redesigned" data-category-parent="${catName}">
                    <td colspan="5">
                        <div class="zone-breakdown-container">
                            <div class="zone-breakdown-cards-container">
                                ${this.availableFilters.zones
									.map((zone) => {
										const zoneCount = monthData?.zone_breakdown[zone] || 0; // Use reaggregated zone breakdown
										const isDisabled = zoneCount === 0;
										return `
                                        <div class="zone-card ${isDisabled ? "disabled-zone-card" : ""}">
                                            <div class="zone-card-name">${zone}</div>
                                            <div class="zone-card-count">
                                                ${
													isDisabled
														? `<span>${zoneCount}</span>`
														: `<span class="zone-drill-link" data-category="${catName}" data-month="${latestMonthKey}" data-zone="${zone}">
                                                        ${zoneCount}
                                                    </span>`
												}
                                            </div>
                                        </div>
                                        `;
									})
									.join("")}
                            </div>
                        </div>
                    </td>
                </tr>
                `;
			}
		});

		html += `
            </tbody>
            <tfoot>
                <tr class="category-total-row">
                    <td>Total</td>
                    <td></td>
                    <td class="count-cell">${totalBranches}</td>
                    <td class="total-movement-cell" data-totals='${JSON.stringify({ increased: totalIncreasedBranches, decreased: totalDecreasedBranches })}'>
                        <div class="movement-summary">
                            <span class="mov-up">↑ ${totalUp}</span>
                            <span class="mov-down">↓ ${totalDown}</span>
                        </div>
                    </td>
                    <td></td>
                </tr>
            </tfoot>
        </table>
        `;
		return html;
	}

	_buildMovementPopupContent(increased, decreased) {
		let leftContent = "",
			rightContent = "";

		if (decreased && decreased.length > 0) {
			leftContent += `<div class="popup-section declined">`;

			leftContent += `<h6>Downgraded (${decreased.length})</h6>`;

			decreased.forEach((item) => {
				leftContent += `

							<div class="popup-item">

								<div class="item-header">

									<span class="branch-name">${item.branch} (${item.zone})</span>

									<span class="cat-change">${item.previous_category} → ${item.current_category}</span>

								</div>

								<div class="item-body">

									<span class="pct-change">${item.previous_percentage.toFixed(2)}% → ${item.current_percentage.toFixed(2)}%</span>

									<span class="diff-change">-₹${this.formatCurrency(Math.abs(item.achievement_diff))} | ${item.percentage_diff.toFixed(2)}%</span>

								</div>

							</div>

						`;
			});

			leftContent += `</div>`;
		}

		if (increased && increased.length > 0) {
			rightContent += `<div class="popup-section improved">`;

			rightContent += `<h6>Upgraded (${increased.length})</h6>`;

			increased.forEach((item) => {
				rightContent += `

							<div class="popup-item">

								<div class="item-header">

									<span class="branch-name">${item.branch} (${item.zone})</span>

									<span class="cat-change">${item.previous_category} → ${item.current_category}</span>

								</div>

								<div class="item-body">

									<span class="pct-change">${item.previous_percentage.toFixed(2)}% → ${item.current_percentage.toFixed(2)}%</span>

									<span class="diff-change">+₹${this.formatCurrency(item.achievement_diff)} | +${item.percentage_diff.toFixed(2)}%</span>

								</div>

							</div>

						`;
			});

			rightContent += `</div>`;
		}

		if (!leftContent && !rightContent) return "";

		const leftColumnHTML = leftContent ? `<div class="popup-column">${leftContent}</div>` : "";

		const rightColumnHTML = rightContent
			? `<div class="popup-column">${rightContent}</div>`
			: "";

		return leftColumnHTML + rightColumnHTML;
	}

	attachMovementPopupHandlers() {
		const self = this;
		let popupTimer;

		const showPopup = function (target, data) {
			clearTimeout(popupTimer);
			$(".movement-popup").remove();

			const popupContent = self._buildMovementPopupContent(data.increased, data.decreased);
			if (!popupContent) return;

			const popup = $(
				`<div class="movement-popup"><div class="popup-main-container">${popupContent}</div></div>`,
			).appendTo("body");
			const popupInner = popup.find(".popup-main-container");

			const targetCell = $(target);
			const cellOffset = targetCell.offset();
			const cellHeight = targetCell.outerHeight();
			const cellWidth = targetCell.outerWidth();

			const windowHeight = $(window).height();
			const scrollY = $(window).scrollTop();
			const spaceAbove = cellOffset.top - scrollY;
			const spaceBelow = windowHeight - (cellOffset.top + cellHeight - scrollY);

			let top, left, maxHeight;
			const margin = 20;

			// Decide position and max-height
			if (spaceBelow > spaceAbove) {
				// Position below
				top = cellOffset.top + cellHeight + 10;
				maxHeight = spaceBelow - margin;
			} else {
				// Position above
				top = cellOffset.top - 10; // Initial top before adjusting for popup height
				maxHeight = spaceAbove - margin;
			}

			popupInner.css("max-height", `${maxHeight}px`);

			const popupHeight = popup.outerHeight();
			const popupWidth = popup.outerWidth();

			// Final position adjustment
			if (spaceBelow < spaceAbove) {
				top = cellOffset.top - popupHeight - 10;
			}

			// Boundary checks
			if (top < scrollY + margin / 2) {
				top = scrollY + margin / 2;
			}

			left = cellOffset.left + cellWidth / 2 - popupWidth / 2;
			if (left < 0) left = 5;
			if (left + popupWidth > $(window).width()) left = $(window).width() - popupWidth - 5;

			popup.css({ top: `${top}px`, left: `${left}px` });

			popup
				.on("mouseenter", function () {
					clearTimeout(popupTimer);
				})
				.on("mouseleave", function () {
					hidePopup();
				});
		};

		const hidePopup = function () {
			popupTimer = setTimeout(() => {
				$(".movement-popup").remove();
			}, 100);
		};

		this.page.main
			.find(".movement-cell .movement-summary")
			.on("mouseenter", function () {
				const changesData = $(this).parent().data("changes");
				if (
					changesData &&
					(changesData.increased.length > 0 || changesData.decreased.length > 0)
				) {
					showPopup(this, changesData);
				}
			})
			.on("mouseleave", function () {
				hidePopup();
			});
	}

	attachTotalMovementPopupHandler() {
		const self = this;
		let popupTimer;

		const showPopup = function (target, data) {
			clearTimeout(popupTimer);
			$(".movement-popup").remove();

			const popupContent = self._buildMovementPopupContent(data.increased, data.decreased);
			if (!popupContent) return;

			const popup = $(
				`<div class="movement-popup"><div class="popup-main-container">${popupContent}</div></div>`,
			).appendTo("body");
			const popupInner = popup.find(".popup-main-container");

			const targetCell = $(target);
			const cellOffset = targetCell.offset();
			const cellHeight = targetCell.outerHeight();
			const cellWidth = targetCell.outerWidth();

			const windowHeight = $(window).height();
			const scrollY = $(window).scrollTop();
			const spaceAbove = cellOffset.top - scrollY;
			const spaceBelow = windowHeight - (cellOffset.top + cellHeight - scrollY);

			let top, left, maxHeight;
			const margin = 20;

			// Decide position and max-height
			if (spaceBelow > spaceAbove) {
				// Position below
				top = cellOffset.top + cellHeight + 10;
				maxHeight = spaceBelow - margin;
			} else {
				// Position above
				top = cellOffset.top - 10; // Initial top before adjusting for popup height
				maxHeight = spaceAbove - margin;
			}

			popupInner.css("max-height", `${maxHeight}px`);

			const popupHeight = popup.outerHeight();
			const popupWidth = popup.outerWidth();

			// Final position adjustment
			if (spaceBelow < spaceAbove) {
				top = cellOffset.top - popupHeight - 10;
			}

			// Boundary checks
			if (top < scrollY + margin / 2) {
				top = scrollY + margin / 2;
			}

			left = cellOffset.left + cellWidth / 2 - popupWidth / 2;
			if (left < 0) left = 5;
			if (left + popupWidth > $(window).width()) left = $(window).width() - popupWidth - 5;

			popup.css({ top: `${top}px`, left: `${left}px` });

			popup
				.on("mouseenter", function () {
					clearTimeout(popupTimer);
				})
				.on("mouseleave", function () {
					hidePopup();
				});
		};

		const hidePopup = function () {
			popupTimer = setTimeout(() => {
				$(".movement-popup").remove();
			}, 100);
		};

		this.page.main
			.find(".total-movement-cell .movement-summary")
			.on("mouseenter", function () {
				const totals = $(this).parent().data("totals");
				if (totals && (totals.increased.length > 0 || totals.decreased.length > 0)) {
					showPopup(this, totals);
				}
			})
			.on("mouseleave", function () {
				hidePopup();
			});
	}

	attachCategoryExpandHandlers() {
		const self = this;

		this.page.main

			.find(".category-row-redesigned")

			.off("click")

			.on("click", function (e) {
				// Stop if a drill-link or movement cell was clicked

				if ($(e.target).closest(".drill-cell, .movement-cell, .zone-drill-link").length) {
					return;
				}

				const catName = $(this).data("category");

				self.state.expandedZones[`cat_${catName}`] =
					!self.state.expandedZones[`cat_${catName}`];

				self.render();
			});
	}

	getChangesBadge(catData) {
		const monthKey = this.months[0]?.key;

		const changes = catData.months[monthKey]?.changes;

		if (!changes) return "—";

		const up = changes.increased?.length || 0;

		const down = changes.decreased?.length || 0;

		if (up === 0 && down === 0) return '<span class="changes-badge">—</span>';

		return `<span class="changes-badge">↑${up} ↓${down}</span>`;
	}

	// ========================================================================

	// DRILL-DOWN FUNCTIONALITY

	// ========================================================================

	attachDrillHandlers() {
		const self = this;

		this.page.main.find(".drill-cell").on("click", function (e) {
			e.stopPropagation();

			const category = $(this).data("category");

			const month = $(this).data("month");

			self.drillDownToCategoryMonth(category, month);
		});
	}

	attachZoneDrillHandlers() {
		const self = this;

		this.page.main.find(".zone-drill-link").on("click", function (e) {
			e.stopPropagation();

			const category = $(this).data("category");

			const month = $(this).data("month");

			const zone = $(this).data("zone");

			self.drillDownToZoneCategoryMonth(category, zone, month);
		});
	}

	drillDownToCategoryMonth(category, month) {
		console.log(`🔍 Drilling down to Category: ${category}, Month: ${month}`);

		this.state.selectedCategories = [category];

		this.state.selectedZones = []; // Clear zone filter

		this.state.selectedMonth = month;

		this.state.drillDownActive = true;

		this.updateFilterTagsUI();

		this.switchTab("branch");
	}

	drillDownToZoneCategoryMonth(category, zone, month) {
		console.log(`🔍 Drilling down to Category: ${category}, Zone: ${zone}, Month: ${month}`);

		this.state.selectedCategories = [category];

		this.state.selectedZones = [zone];

		this.state.selectedMonth = month;

		this.state.drillDownActive = true;

		this.updateFilterTagsUI();

		this.switchTab("branch");
	}

	attachZoneDrilldownHandlers() {
		const self = this;
		this.page.main.find(".zone-wise-table .branch-drilldown").on("click", function (e) {
			e.stopPropagation();

			const zone = $(this).data("zone");
			const region = $(this).data("region");
			const district = $(this).data("district");

			self.drillDownToBranchView(zone, region, district);
		});
	}

	drillDownToBranchView(zone, region = null, district = null) {
		console.log(
			`Drilling down to Branch view for Zone: ${zone}` +
				(region ? `, Region: ${region}` : "") +
				(district ? `, District: ${district}` : ""),
		);

		this.state.selectedZones = [zone];
		this.state.selectedRegions = region ? [region] : [];
		this.state.selectedDistricts = district ? [district] : [];
		this.state.drillDownActive = true;

		// Update filter UI elements to reflect the change
		this.updateRegionDropdownUI();
		this.updateFilterTagsUI(); // this will highlight the correct zone

		this.switchTab("branch");
	}

	buildBranchTable(branchData, months) {
		if (branchData.length === 0) {
			return `
                <div style="text-align: center; padding: 50px; color: #778da9; font-size: 16px;">
                    <div style="font-size: 48px; margin-bottom: 15px;">📭</div>
                    <div style="font-weight: 600; margin-bottom: 8px;">No branches found</div>
                    <div style="font-size: 13px;">Try adjusting your filters</div>
                </div>
            `;
		}

		let displayMonths = months;
		if (this.state.viewType === "Monthly" && this.state.selectedMonth) {
			displayMonths = months.filter((m) => m.key === this.state.selectedMonth);
		}

		// --- Correct Performance Segmentation Logic ---

		// 1. Determine the metric for sorting (latest month's percentage)
		const sortMonthKey =
			this.state.selectedMonth || (months.length > 0 ? months[months.length - 1].key : null);

		// 2. Create a safe copy of the filtered data and sort it by performance
		const sortedBranches = [...branchData].sort((a, b) => {
			const aPct = a.months[sortMonthKey]?.percentage || 0;
			const bPct = b.months[sortMonthKey]?.percentage || 0;
			return bPct - aPct; // Descending sort
		});

		// 3. Calculate quartile boundaries and assign segments to the sorted branches
		const total = sortedBranches.length;
		sortedBranches.forEach((branch, index) => {
			if (total < 4) {
				branch.performanceSegment = "N/A";
				branch.rowStyle = "";
			} else {
				const top25_index = Math.floor(total * 0.25);
				const next25_index = Math.floor(total * 0.5);
				const mid25_index = Math.floor(total * 0.75);

				if (index < top25_index) {
					branch.performanceSegment = "Top 25%";
					branch.rowStyle = "";
				} else if (index < next25_index) {
					branch.performanceSegment = "Next 25%";
					branch.rowStyle = "";
				} else if (index < mid25_index) {
					branch.performanceSegment = "Mid 25%";
					branch.rowStyle = "";
				} else {
					branch.performanceSegment = "Bottom 25%";
					branch.rowStyle = "";
				}
			}
		});

		// 4. Filter the now-segmented list based on the user's segment selection
		let filteredBranchData = sortedBranches;
		if (this.state.selectedSegment && this.state.selectedSegment !== "all") {
			filteredBranchData = sortedBranches.filter(
				(branch) => branch.performanceSegment === this.state.selectedSegment,
			);
		}

		const header = this.buildBranchTableHeader(displayMonths);
		const body = filteredBranchData
			.map((branch, index) =>
				this.buildBranchTableRow(
					branch,
					displayMonths,
					index + 1,
					branch.rowStyle,
					branch.performanceSegment,
				),
			)
			.join("");
		return `
            <table class="branch-table">
                ${header}
                <tbody>${body}</tbody>
            </table>
        `;
	}

	buildBranchTableHeader(months) {
		let header = `
            <thead>
                <tr class="branch-table-header">
                    <th rowspan="2" class="sr-col">Sr. No.</th>
                    <th rowspan="2" class="branch-col">Branch</th>
					<th rowspan="2" class="segment-col">Segments</th>
        `;

		const today = new Date();
		const currentMonth = today.getMonth();
		const currentYear = today.getFullYear();

		months.forEach((month) => {
			const monthDate = new Date(month.date);
			const monthIndex = monthDate.getMonth();
			const monthYear = monthDate.getFullYear();

			const monthName = month.display.split("-")[0];
			const displayYear = `${monthName}-${monthYear}`;

			let daysLeftIndicator = "";
			let highlightStyle = "";
			if (monthIndex === currentMonth && monthYear === currentYear) {
				const currentDay = today.getDate();
				const remainingDays = getRemainingWorkingDaysExcludingSundays(
					currentYear,
					currentMonth,
					currentDay,
				);

				if (remainingDays >= 0) {
					daysLeftIndicator = `
										<br>
										<span class="days-left-indicator">
											${remainingDays} Working Day${remainingDays !== 1 ? "s" : ""} Left
										</span>
									`;
				}
				highlightStyle = `background: #6ca8ac !important; color: #ffffff !important; border-bottom: 2px solid #558a8e !important;`;
			}

			header += `<th colspan="6" class="month-col" ${highlightStyle ? `style="${highlightStyle}"` : ""}>${displayYear}${daysLeftIndicator}</th>`;
		});
		header += `</tr><tr class="branch-table-subheader">`;

		months.forEach(() => {
			header += `
                <th>Category</th>
                <th>Target</th>
                <th>Ach.</th>
                <th>ACH %</th>
                <th>Ach Gap</th>
                <th>Ach Gap %</th>
            `;
		});

		header += `</tr></thead>`;

		const styleId = "days-left-indicator-style";
		if (!document.getElementById(styleId)) {
			const style = document.createElement("style");
			style.id = styleId;
			style.innerHTML = `
                @keyframes smooth-blink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.3; }
                }
                .days-left-indicator {
                    color: red;
                    font-weight: bold;
                    animation: smooth-blink 1.5s infinite;
                    font-size: 12px;
                }
            `;
			document.head.appendChild(style);
		}

		return header;
	}

	buildBranchTableRow(branch, months, serialNo, rowStyle = "", segmentName = "") {
		let html = `<tr class="branch-table-row" data-sol-id="${branch.sol_id}" style="${rowStyle}">`;
		html += `<td class="sr-col">${serialNo}</td>`;
		html += `<td class="branch-col">
			<div class="branch-info">
				<div class="branch-zone-region">
					<span class="zone-badge">${branch.zone}</span>
					<span class="region-label">${branch.region}</span>
				</div>
				<div class="branch-district">${branch.district || ''}</div>
				<div class="branch-code-name">
					<a onclick="window.showBranchProfilePopup('${branch.sol_id}'); return false;" class="branch-code-link" style="cursor: pointer; text-decoration: underline;">${branch.sol_id}-${branch.branch.replace(/\s*BRANCH\s*$/i, '')}</a>
				</div>
			</div>
		</td>`;
		html += `<td class="segment-col">${segmentName}</td>`;

		months.forEach((month) => {
			const mdata = branch.months[month.key];
			if (mdata) {
				const pct = mdata.percentage || 0;
				const gapVal = Math.max(0, (mdata.target || 0) - (mdata.achievement || 0));
				const gapPct = (mdata.target || 0) > 0 ? (gapVal / mdata.target) * 100 : 0;

				html += `
                 <td class="metric-cell category-cell">${this.getCategoryBadge(
						mdata.category,
						"small",
					)}</td>
                 <td class="metric-cell amount-cell">${this.formatNumber(mdata.target)}</td>
                 <td class="metric-cell amount-cell">${this.formatNumber(mdata.achievement)}</td>
                 <td>
					<div style="display: flex; align-items: center; gap: 4px; justify-content: center;">
						<span class="pct-value" style="color: ${this.getPctColor(pct)}; min-width: 36px; text-align: right;">${Math.round(pct)}%</span>
						${this.renderProgressBar(pct)}
					</div>
				</td>
                 <td class="metric-cell amount-cell">${this.formatNumber(gapVal)}</td>
                 <td>
					<div style="display: flex; align-items: center; gap: 4px; justify-content: center;">
						<span class="pct-value" style="color: ${this.getPctColor(100 - gapPct)}; min-width: 36px; text-align: right;">${Math.round(gapPct)}%</span>
						${this.renderProgressBar(gapPct, this.getPctColor(100 - gapPct))}
					</div>
				</td>
            `;
			} else {
				html += "<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>";
			}
		});

		return html + "</tr>";
	}

	// ========================================================================
	// UTILITY FUNCTIONS
	// ========================================================================
	formatNumber(value) {
		return this.formatCurrency(value);
	}

	formatCurrency(value) {
		if (value === null || value === undefined || value === 0) return "-";
		const isNegative = value < 0;
		const absVal = Math.abs(value);
		const numValue = Math.round(absVal);

		let formatted = "";
		if (this.state.formatMode === "words") {
			if (numValue >= 1000000000) {
				formatted = `${(numValue / 10000000).toFixed(2)} Cr`;
			} else if (numValue >= 10000000) {
				formatted = `${(numValue / 10000000).toFixed(2)} Cr`;
			} else if (numValue >= 100000) {
				formatted = `${(numValue / 100000).toFixed(2)} L`;
			} else if (numValue >= 1000) {
				formatted = `${(numValue / 1000).toFixed(2)} K`;
			} else {
				formatted = numValue.toString();
			}
		} else {
			formatted = new Intl.NumberFormat("en-IN").format(numValue);
		}

		return isNegative ? `-${formatted}` : formatted;
	}


	getPctColor(pct) {
		const hue = Math.min(120, Math.max(0, (pct / 100) * 120));
		const lightness = hue > 45 && hue < 75 ? "35%" : "40%";
		return `hsl(${hue}, 85%, ${lightness})`;
	}

	renderProgressBar(percentage, customColor) {
		const pct = Math.max(0, Math.min(100, percentage || 0));
		const color = customColor || this.getPctColor(pct);

		return `
			<div class="progress-container-3d">
				<div class="progress-bar-3d" style="width: ${pct}%; background-color: ${color};"></div>
			</div>
		`;
	}

	getStatusIcon(status) {
		const icons = {
			improved: "🟢",
			declined: "🔴",
			increased: "🟡↑",
			decreased: "🟠↓",
			unchanged: "⚪",
			new: "✨",
		};
		return icons[status] || "";
	}

	getCategoryBadge(category, size = "normal") {
		const categoryConfig = {
			"Pinnacle":    { text: "#6D28D9", bg: "#F5F3FF", border: "#C4B5FD" },
			"Master":      { text: "#1D4ED8", bg: "#EFF6FF", border: "#93C5FD" },
			"Accelerator": { text: "#047857", bg: "#ECFDF5", border: "#6EE7B7" },
			"Starter":     { text: "#B45309", bg: "#FFFBEB", border: "#FDE68A" },
			"Learner":     { text: "#BE185D", bg: "#FDF2F8", border: "#F9A8D4" },
			"Zero Level":  { text: "#991B1B", bg: "#FEF2F2", border: "#FECACA" },
			"Zero":        { text: "#991B1B", bg: "#FEF2F2", border: "#FECACA" }
		};
		const config = categoryConfig[category] || { text: "#64748b", bg: "#f8fafc", border: "#e2e8f0" };
		const fontSize = size === "small" ? "10px" : "12px";
		return `<span class="category-badge" style="background:${config.bg};color:${config.text};border:1px solid ${config.border};padding:4px 8px;border-radius:4px;font-size:${fontSize};font-weight:700;display:inline-block;text-transform:uppercase;">${category}</span>`;
	}

	updateSummaryCards(filteredBranches, reaggregatedZoneData) {
		if (!this.months || this.months.length === 0) return;

		const currentMonthKey = this.months[0].key;

		// 1. Total Branches - Count from filtered branches
		const totalBranches = filteredBranches.length;
		this.page.main.find("#summary-total-branches").text(totalBranches);

		// Trend calculation (vs previous month if available)
		const prevMonthKey = this.months.length > 1 ? this.months[1].key : null;
		const trendEl = this.page.main.find("#summary-branches-trend");
		if (prevMonthKey) {
			const currentCount = filteredBranches.filter((b) => b.months[currentMonthKey]).length;
			const prevCount = filteredBranches.filter((b) => b.months[prevMonthKey]).length;
			if (prevCount > 0) {
				const diff = ((currentCount - prevCount) / prevCount) * 100;
				trendEl.text(`${diff >= 0 ? "+" : ""}${diff.toFixed(1)}% from last month`);
				trendEl
					.removeClass("success danger muted")
					.addClass(diff >= 0 ? "success" : "danger");
			} else {
				trendEl
					.text("New data this month")
					.removeClass("success danger")
					.addClass("muted");
			}
		} else {
			trendEl.text("Reporting Period").removeClass("success danger").addClass("muted");
		}

		// 2. Target Amount & Achievement - Sum from Zone Wise reaggregated data
		let totalTarget = 0;
		let totalAch = 0;
		reaggregatedZoneData.forEach((item) => {
			if (item.isZoneTotal) {
				if (this.state.viewType === "Quarterly" || this.state.viewType === "Yearly") {
					this.months.forEach((month) => {
						const mdata = item.months[month.key];
						if (mdata) {
							totalTarget += mdata.target || 0;
							totalAch += mdata.achievement || 0;
						}
					});
				} else {
					const mdata = item.months[currentMonthKey];
					if (mdata) {
						totalTarget += mdata.target || 0;
						totalAch += mdata.achievement || 0;
					}
				}
			}
		});

		this.page.main.find("#summary-target-amount").text("₹" + this.formatCurrency(totalTarget));
		let targetLabelText = `${this.normalizeTargetType(this.state.targetType)} target`;
		if (this.state.viewType === "Quarterly") {
			targetLabelText = "Quarterly target";
		} else if (this.state.viewType === "Yearly") {
			targetLabelText = "Yearly target";
		}

		this.page.main.find("#summary-target-label").text(targetLabelText);
		this.page.main
			.find("#summary-achievement-amount")
			.text("₹" + this.formatCurrency(totalAch));

		// Achievement Percentage
		const pct = totalTarget > 0 ? (totalAch / totalTarget) * 100 : 0;
		const pctEl = this.page.main.find("#summary-achievement-pct");
		pctEl.text(Math.round(pct) + "% achieved");

		// Color transition from red to green based on percentage
		const hue = Math.min(120, Math.max(0, (pct / 100) * 120));
		const lightness = hue > 45 && hue < 75 ? "35%" : "40%";
		pctEl.css("color", `hsl(${hue}, 85%, ${lightness})`);
		pctEl.removeClass("success danger");

		// 3. Gap Calculation & Subtext
		const gap = totalTarget - totalAch;
		const gapAmount = gap > 0 ? gap : 0;
		this.page.main.find("#summary-gap-amount").text("₹" + this.formatCurrency(gapAmount));

		const gapSubtextEl = this.page.main.find("#summary-gap-subtext");
		if (totalTarget > 0 && gap > 0) {
			const gapPct = (gap / totalTarget) * 100;
			gapSubtextEl.text(Math.round(gapPct) + "% gap");
			gapSubtextEl.css("color", "").removeClass("success muted").addClass("danger");
		} else if (totalTarget > 0 && gap <= 0) {
			gapSubtextEl.text("Target Achieved");
			gapSubtextEl.css("color", "").removeClass("danger muted").addClass("success");
		} else {
			gapSubtextEl.text("0% gap");
			gapSubtextEl.css("color", "").removeClass("danger success").addClass("muted");
		}

		// 4. Active Zones - Unique zones in reaggregated data
		const activeZonesCount = reaggregatedZoneData.filter((item) => item.isZoneTotal).length;
		this.page.main.find("#summary-active-zones").text(activeZonesCount + " Zones");
	}

	// ========================================================================
	// STYLES
	// ========================================================================
	setupStyles() {
		const styles = `
            <style>
                #date-selector-container .form-group {
                    margin-bottom: 0 !important;
                }

                /* Remove top margin of dashboard tables to eliminate header gap */
                .zone-wise-table,
                .branch-table,
                .agent-wise-table,
                .product-wise-table,
                .gl-wise-table,
                .category-table-redesigned {
                    margin-top: 0 !important;
                }

                /* Outlined Inputs (Material Design Style) */
                .outlined-input-container {
                    position: relative;
                    display: inline-flex;
                    align-items: center;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                    background: #ffffff;
                    height: 32px;
                    margin-top: 6px; /* space for overlapping label */
                    box-sizing: border-box;
                    transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
                }

                #date-selector-container.outlined-input-container {
                    padding: 0 6px 0 10px;
                    width: 154px;
                }
                
                .fy-header-control.outlined-input-container {
                    padding: 0 6px 0 10px;
                }

                #month-selector-container.outlined-input-container {
                    padding: 0 6px 0 10px;
                    width: 140px;
                }

                #region-dropdown-container.outlined-input-container {
                    padding: 0 10px;
                    min-width: 170px;
                }

                .outlined-input-label {
                    position: absolute;
                    left: 10px;
                    top: -8px;
                    background: #ffffff;
                    padding: 0 4px;
                    font-size: 11px;
                    font-weight: 700;
                    color: #64748b;
                    pointer-events: none;
                    z-index: 10;
                    line-height: 1;
                    transition: color 0.15s ease-in-out;
                }

                /* Outlined selectors, inputs, & buttons styles */
                .outlined-input-container select,
                .outlined-input-container input:not([type="checkbox"]),
                .outlined-input-container button {
                    border: none !important;
                    background: transparent !important;
                    outline: none !important;
                    box-shadow: none !important;
                    font-size: 13px !important;
                    font-weight: 600 !important;
                    color: #1b263b !important;
                    height: 28px !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    width: 100% !important;
                }

                /* Frappe wrapper styling overrides to let it fit within container */
                #date-selector-container .frappe-control,
                #date-selector-container .form-group,
                #date-selector-container .control-input-wrapper,
                #date-selector-container .control-input {
                    display: inline-block !important;
                    width: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    height: 100% !important;
                }
                
                #date-selector-container .clearfix {
                    display: none !important;
                }

                /* Container hover/focus states */
                .outlined-input-container:hover {
                    border-color: #94a3b8;
                }

                .outlined-input-container:focus-within {
                    border-color: #417d81 !important;
                    box-shadow: 0 0 0 3px rgba(65, 125, 129, 0.15) !important;
                }

                .outlined-input-container:focus-within .outlined-input-label {
                    color: #417d81 !important;
                }

                /* Region Dropdown menu styling for perfect alignment */
                #region-dropdown-menu {
                    padding: 4px 0 !important;
                    border: 1px solid #cbd5e1 !important;
                    border-radius: 8px !important;
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05) !important;
                }

                #region-dropdown-menu li {
                    display: flex !important;
                    align-items: center !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    transition: background-color 0.15s ease !important;
                }

                #region-dropdown-menu li:hover {
                    background-color: #f1f5f9 !important;
                }

                #region-dropdown-menu label {
                    display: inline-flex !important;
                    align-items: center !important;
                    width: 100% !important;
                    margin: 0 !important;
                    padding: 8px 16px !important;
                    font-size: 13px !important;
                    font-weight: 500 !important;
                    color: #1b263b !important;
                    cursor: pointer !important;
                    user-select: none !important;
                }

                #region-dropdown-menu input[type="checkbox"] {
                    position: relative !important;
                    margin: 0 10px 0 0 !important;
                    padding: 0 !important;
                    width: 15px !important;
                    height: 15px !important;
                    cursor: pointer !important;
                }

                .format-toggle-btn.active {
                    background-color: #417d81 !important;
                    border-color: #417d81 !important;
                    color: #ffffff !important;
                    font-weight: 700 !important;
                }
                .format-toggle-btn:not(.active) {
                    background-color: #ffffff !important;
                    border-color: #cbd5e1 !important;
                    color: #1e293b !important;
                    font-weight: 500 !important;
                }
                .format-toggle-btn:not(.active):hover {
                    background-color: #f1f5f9 !important;
                    border-color: #94a3b8 !important;
                    color: #0f172a !important;
                }

                /* Filter Tags Styles - Stacked vertically: Zone on top, Category below */
                .filter-tags-row {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    margin-bottom: 6px;
                    width: 100%;
                }
                .zone-filter-container {
                    width: 100%;
                    padding-bottom: 10px;
                    border-bottom: 1px dashed #d1d5db;
                }
                .category-filter-container {
                    width: 100%;
                    padding-top: 4px;
                }
                .filter-tags-container {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 10px;
                    padding: 6px 12px;
                    background: #ffffff;
                    border: 1px solid #cbd5e1;
                    border-radius: 8px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
                    align-self: stretch; /* Forces identical height stretch */
                    box-sizing: border-box;
                }

                .filter-group {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                }

                .filter-group-label {
                    font-size: 13px;
                    font-weight: 700;
                    color: #0f172a;
                    white-space: nowrap;
                }

                @media (max-width: 991px) {
                    .filter-tags-row {
                        gap: 8px;
                    }
                    .filter-tags-container {
                        padding: 4px 8px;
                        gap: 6px;
                    }
                    .filter-group {
                        gap: 6px;
                    }
                    .filter-group-label {
                        font-size: 12px;
                    }
                }

                .filter-tags {
                    display: flex;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 8px;
                    flex: 1 1 0;
                    min-width: 0;
                }

                #zone-tags {
                    gap: 5px;
                }

                .filter-tag {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 18px;
                    background: #ffffff;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    font-size: 14px;
                    font-weight: 700;
                    color: #1e293b;
                    cursor: pointer;
                    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
                    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                }

                .zone-tag {
                    padding: 8px 18px;
                    gap: 6px;
                    font-size: 13px;
                }

                .zone-tag .filter-tag-count {
                    padding: 3px 8px;
                    font-size: 11px;
                }

                .zone-tag-content {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    line-height: 1.2;
                }

                .zone-tag-pct {
                    font-size: 11px;
                    font-weight: 700;
                    color: #64748b;
                    line-height: 1;
                    margin-left: auto;
                }

                .filter-tag:hover {
                    background: #f8fafc;
                    border-color: #cbd5e1;
                    transform: translateY(-1px);
                    text-decoration: none;
                }

                .filter-tag:active {
                    transform: scale(0.96);
                    transition: transform 0.1s ease;
                }

                @keyframes capsuleGlow {
                    0% { box-shadow: 0 0 0 0 rgba(13, 148, 136, 0); }
                    50% { box-shadow: 0 0 8px 3px rgba(13, 148, 136, 0.3); }
                    100% { box-shadow: 0 0 0 0 rgba(13, 148, 136, 0); }
                }

                .filter-tag.active {
                    background: #0d9488 !important;
                    border-color: #0d9488 !important;
                    color: #ffffff !important;
                    box-shadow: 0 4px 12px rgba(13, 148, 136, 0.25);
                    animation: capsuleGlow 0.4s ease-out;
                }

                .filter-tag-count {
                    background: #f1f5f9;
                    color: #64748b;
                    padding: 4px 10px;
                    border-radius: 9999px;
                    font-size: 12px;
                    font-weight: 700;
                    transition: all 0.2s ease;
                }

                .filter-tag.active .filter-tag-count {
                    background: rgba(255, 255, 255, 0.25) !important;
                    color: #ffffff !important;
                }

                .category-tag {
                    flex-direction: row;
                    align-items: center;
                    justify-content: center;
                    padding: 8px 14px;
                    gap: 6px !important;
                    font-size: 13px;
                    font-weight: 600;
                    background-image: linear-gradient(to right, var(--fill-color, transparent) var(--fill-pct, 0%), #ffffff var(--fill-pct, 0%));
                }

                .category-tag:hover {
                    background-image: linear-gradient(to right, var(--fill-color, transparent) var(--fill-pct, 0%), #f8fafc var(--fill-pct, 0%)) !important;
                }

                .category-tag.active {
                    background-image: none !important;
                }

                .category-tag .filter-tag-count {
                    padding: 3px 8px;
                    font-size: 10px;
                    font-weight: 700;
                    border: 1px solid currentColor;
                    border-radius: 9999px;
                    transition: all 0.2s ease;
                }

                .category-tag-name {
                    color: inherit;
                    font-weight: 700;
                }

                .category-tag-pct {
                    font-size: 11px;
                    font-weight: 700;
                    color: inherit;
                    line-height: 1;
                    margin-left: auto;
                }

                .category-tag.active .category-tag-name,
                .category-tag.active .category-tag-pct,
                .category-tag.active .filter-tag-count {
                    color: #ffffff !important;
                    border-color: rgba(255, 255, 255, 0.4) !important;
                }

                .category-tag.active .filter-tag-count {
                    background-color: rgba(255, 255, 255, 0.25) !important;
                }

                .category-tag-content {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    line-height: 1.2;
                }

                /* Category-specific Active Colors */
                .category-tag[data-category="Pinnacle"].active {
                    background-color: #6D28D9 !important;
                    border-color: #6D28D9 !important;
                    color: #ffffff !important;
                    box-shadow: 0 4px 12px rgba(109, 40, 217, 0.25);
                }
                .category-tag[data-category="Master"].active {
                    background-color: #1D4ED8 !important;
                    border-color: #1D4ED8 !important;
                    color: #ffffff !important;
                    box-shadow: 0 4px 12px rgba(29, 78, 216, 0.25);
                }
                .category-tag[data-category="Accelerator"].active {
                    background-color: #047857 !important;
                    border-color: #047857 !important;
                    color: #ffffff !important;
                    box-shadow: 0 4px 12px rgba(4, 120, 87, 0.25);
                }
                .category-tag[data-category="Starter"].active {
                    background-color: #B45309 !important;
                    border-color: #B45309 !important;
                    color: #ffffff !important;
                    box-shadow: 0 4px 12px rgba(180, 83, 9, 0.25);
                }
                .category-tag[data-category="Learner"].active {
                    background-color: #BE185D !important;
                    border-color: #BE185D !important;
                    color: #ffffff !important;
                    box-shadow: 0 4px 12px rgba(190, 24, 93, 0.25);
                }
                .category-tag[data-category="Zero Level"].active {
                    background-color: #991B1B !important;
                    border-color: #991B1B !important;
                    color: #ffffff !important;
                    box-shadow: 0 4px 12px rgba(153, 27, 27, 0.25);
                }


                /* Toggle Button Styles */
                .btn-group .btn {
                    background: #fff;
                    border: 1px solid #cbd5e1;
                    color: #1b263b;
                    padding: 6px 12px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .btn-group .btn:hover {
                    background: #f8f9fa;
                    border-color: #417d81;
                }

                .btn-group .btn.active {
                    background: #417d81;
                    border-color: #417d81;
                    color: #e0e1dd;
                }

                /* Tab Styles (Active Capsule, Inactive Flat) */
                .tab-btn {
                    padding: 6px 16px !important;
                    background: transparent !important;
                    border: none !important;
                    color: #64748b !important;
                    font-weight: 600 !important;
                    font-size: 13px !important;
                    cursor: pointer !important;
                    border-radius: 9999px !important;
                    transition: all 0.15s ease-in-out !important;
                    outline: none !important;
                    margin: 0 !important;
                }

                .tab-btn:hover {
                    color: #417d81 !important;
                    background: rgba(65, 125, 129, 0.08) !important;
                }

                .tab-btn.active {
                    background: #417d81 !important;
                    color: #ffffff !important;
                    font-weight: 700 !important;
                    box-shadow: 0 4px 10px rgba(65, 125, 129, 0.25) !important;
                }

                /* Zone Table Styles */
                .zone-wise-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }

             .zone-table-header th {
    /* Primary color #3d7579 with a subtle darkening for depth */
    background: linear-gradient(180deg, #3d7579 0%, #346569 100%);
    
    /* Pure white for maximum readability and a clean look */
    color: #ffffff;
    
    /* Professional spacing and typography */
    padding: 14px 10px;
    text-align: center;
    font-weight: 600;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.03em;

    /* Border adjusted to a darker shade of your teal to look integrated */
    border: 1px solid #2d5659;
    
    /* Optional: subtle top highlight for a "premium" feel */
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

               .zone-table-subheader th {
    /* A slightly lighter, muted teal to distinguish it from the main header */
    background: #4a8a8f; 
    
    /* Pure white for clarity, keeping the font size small as requested */
    color: #ffffff;
    padding: 8px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    
    /* Border that blends with the teal theme instead of the old blue-grey */
    border: 1px solid #366b6f;
}

                .zone-wise-table td {
                    padding: 10px 8px;
                    border: 1px solid #cbd5e1;
                    text-align: center;
                }

                .zone-total-row {
                    background-color: #e0e1dd !important;
                    font-weight: bold;
                    cursor: pointer;
                }

                .zone-total-row:hover {
                    background-color: #d4d5d1 !important;
                }

                .branch-drilldown {
                    cursor: pointer;
                    text-decoration: underline;
                    color: #007bff;
                    font-weight: 600;
                }
                .branch-drilldown:hover {
                    color: #0056b3;
                    font-weight: bold;
                }

                .zone-toggle, .category-toggle {
                    display: inline-block;
                    width: 20px;
                    margin-right: 8px;
                    transition: transform 0.2s ease;
                }

                .region-detail-row {
                    background: #fff;
                    border-left: 4px solid #417d81;
                }

                /* Category Table Styles */
                .category-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }

                .category-table-header th {
                    background: linear-gradient(135deg, #0d1b2a 0%, #1b263b 100%);
                    color: #e0e1dd;
                    padding: 12px 8px;
                    font-weight: 600;
                    border: 1px solid #cbd5e1;
                    text-align: center;
                }

                .category-table-subheader th {
                    background: #1b263b;
                    color: #e0e1dd;
                    padding: 8px;
                    font-size: 11px;
                    border: 1px solid #cbd5e1;
                }

                .category-table td {
                    padding: 10px 8px;
                    border: 1px solid #cbd5e1;
                    text-align: center;
                }

                .category-header-row {
                    background: #e0e1dd;
                    font-weight: 600;
                    cursor: pointer;
                }

                .category-header-row:hover {
                    background: #d4d5d1;
                }

                .zone-breakdown-row {
                    background: #fff;
                    border-left: 4px solid #417d81;
                }

                .drill-cell {
                    cursor: pointer;
                }

                .drill-link {
                    color: #417d81;
                    text-decoration: underline;
                }

                .drill-link:hover {
                    color: #0d1b2a;
                    font-weight: bold;
                }

                .changes-badge {
                    display: inline-block;
                    margin-left: 10px;
                    font-size: 12px;
                    font-weight: bold;
                    color: #417d81;
                }

                /* Branch Table Styles */
                .branch-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }

              .branch-table-header th {
    /* Using your teal color #3d7579 with a subtle professional gradient */
    background: linear-gradient(180deg, #3d7579 0%, #346569 100%);
    
    /* Clean white text for better readability */
    color: #ffffff;
    
    /* Standardized padding and typography */
    padding: 12px 8px;
    text-align: center;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;

    /* Matching teal border to replace the old blue-grey */
    border: 1px solid #2d5659;
    
    /* Internal highlight for a modern, polished look */
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

               .branch-table-subheader th {
    /* A lighter, muted teal that complements #3d7579 */
    background: #4a8a8f;
    
    /* White text for sharp contrast on a smaller font */
    color: #ffffff;
    padding: 8px;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    
    /* Matching teal border to replace the old grey-blue */
    border: 1px solid #366b6f;
}

                .branch-table-row {
                    border-bottom: 1px solid #e0e1dd;
                }

                .branch-table-row:hover {
                    background: #e2e8f0 !important;
                }
                .branch-table-row:hover td.sr-col,
                .branch-table-row:hover td.branch-col,
                .branch-table-row:hover td.segment-col {
                    background: #e2e8f0 !important;
                }

                .branch-table thead {
                    position: sticky;
                    top: 0;
                    z-index: 10;
                }

                .branch-table td {
                    padding: 10px 8px;
                    border: 1px solid #cbd5e1;
                }

                /* Agent Wise Table - Match Branch Table Styling */
                .agent-wise-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 12px;
                }
                .agent-wise-table th {
                    background: linear-gradient(180deg, #3d7579 0%, #346569 100%);
                    color: #ffffff;
                    padding: 12px 8px;
                    text-align: center;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                    border: 1px solid #2d5659;
                    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
                }
                .agent-wise-table .branch-table-subheader th {
                    background: #4a8a8f;
                    color: #ffffff;
                    padding: 8px;
                    font-size: 11px;
                    font-weight: 500;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                    border: 1px solid #366b6f;
                }
                .agent-wise-table .agent-zone-row,
                .agent-wise-table .agent-region-row {
                    border-bottom: 1px solid #e0e1dd;
                }
                .agent-wise-table .agent-region-row:hover {
                    background: #f8f9fa;
                }
                .agent-wise-table td {
                    padding: 10px 8px;
                    border: 1px solid #cbd5e1;
                }

                .sr-col {
                    width: 60px;
                    text-align: center;
                }

                .branch-col {
                    min-width: 200px;
                }

                .branch-info {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                }

                .branch-code-name {
                    display: flex;
                    align-items: center;
                }

                /* Agent toggle - keep arrow and zone name in same row */
                .agent-zone-row .branch-code-name {
                    flex-direction: row;
                    align-items: center;
                    gap: 8px;
                }

                .branch-code-link {
                    color: #417d81;
                    font-weight: 600;
                    text-decoration: none;
                    font-size: 11px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    display: inline-block;
                    max-width: 100%;
                    vertical-align: middle;
                }

                .branch-code-link:hover {
                    text-decoration: underline;
                }

                .branch-district {
                    font-size: 11px;
                    color: #475569;
                    margin: 2px 0;
                }

                .branch-name {
                    color: #1b263b;
                    font-size: 12px;
                }

                .branch-zone-region {
                    display: flex;
                    gap: 8px;
                    align-items: center;
                }

                .zone-badge {
                    background: #417d81;
                    color: #e0e1dd;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 600;
                }

                .region-label {
                    color: #778da9;
                    font-size: 11px;
                }

                .metric-cell {
                    text-align: center;
                }

                .category-cell {
                    min-width: 100px;
                }

                .amount-cell {
                    min-width: 90px;
                    font-weight: 500;
                }

                .pct-cell {
                    min-width: 80px;
                    font-weight: 600;
                }

                .status-badge {
                    display: inline-block;
                    margin-left: 8px;
                    font-size: 10px;
                    font-weight: 600;
                    padding: 2px 6px;
                    border-radius: 4px;
                    color: #fff;
                }
                .status-badge.improved { background-color: #10b981; }
                .status-badge.declined { background-color: #dc2626; }
                .status-badge.increased { background-color: #f59e0b; }
                .status-badge.decreased { background-color: #ef4444; }
                .status-badge.unchanged { background-color: #778da9; }
                .status-badge.new { background-color: #3b82f6; }

                /* Redesigned Category Table */
                .category-table-redesigned {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 14px;
                    border: 1px solid #dee2e6;
                }
                .category-table-redesigned th {
                    background: linear-gradient(180deg, #3d7579 0%, #346569 100%) !important;
                    color: #ffffff !important;
                    font-weight: 600;
                    padding: 12px 15px;
                    text-align: left !important;
                    border: 1px solid #2d5659 !important;
                }
                .category-table-redesigned td {
                    padding: 15px;
                    border-bottom: 1px solid #dee2e6;
                    vertical-align: middle;
                }
                .cat-name-cell {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-weight: 600;
                }
                .cat-grade {
                    flex-shrink: 0;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    color: white;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    font-weight: 700;
                }
                .perf-band-cell {
                    font-family: 'monospace';
                    font-weight: 600;
                    color: #495057;
                }
                .count-cell {
                    font-weight: 700;
                    font-size: 18px;
                    text-align: center;
                }
                .movement-cell {
                    cursor: pointer;
                }
                .movement-summary {
                    display: flex;
                    gap: 15px;
                    font-weight: 700;
                    font-size: 16px;
                    justify-content: center;
                }
                .mov-up { color: #10b981; }
                .mov-down { color: #dc2626; }
                .mov-neutral { color: #6c757d; }
                .health-cell {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 600;
                    color: #495057;
                }
                .health-indicator {
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                }

                /* Movement Popup */
                .movement-popup {
                    position: absolute;
                    background-color: #fff;
                    border: 1px solid #ccc;
                    box-shadow: 0 5px 15px rgba(0,0,0,0.15);
                    border-radius: 8px;
                    padding: 0;
                    z-index: 1000;
                    max-width: 700px;
                    min-width: 350px;
                    font-size: 13px;
                }
                .popup-main-container {
                    display: flex;
                }
                .popup-column {
                    flex: 1;
                    padding: 12px;
                    min-width: 320px;
                }
                .popup-column:first-child:not(:only-child) {
                    border-right: 1px solid #eee;
                }
                .popup-section { margin-bottom: 10px; }
                .popup-section:last-child { margin-bottom: 0; }
                .popup-section h6 {
                    font-weight: 700;
                    margin: 0 0 8px 0;
                    padding-bottom: 5px;
                    border-bottom: 1px solid #eee;
                }
                .popup-section.improved h6 { color: #10b981; }
                .popup-section.declined h6 { color: #dc2626; }
                .popup-item {
                    padding: 8px;
                    border-radius: 4px;
                    margin-bottom: 6px;
                }
                .popup-section.improved .popup-item { background-color: #f0fff4; }
                .popup-section.declined .popup-item { background-color: #fff5f5; }
                .item-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 4px;
                }
                .item-header .branch-name { font-weight: 600; color: #333; }
                .item-header .cat-change { font-weight: 600; font-size: 12px; }
                .item-body {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    font-size: 12px;
                    color: #555;
                }
                .item-body .pct-change { font-family: monospace; }
                .item-body .diff-change { font-weight: 600; }
                .popup-section.improved .diff-change { color: #10b981; }
                .popup-section.declined .diff-change { color: #dc2626; }

                .category-row-redesigned {
                    cursor: pointer;
                }
                .category-row-redesigned:hover {
                    background-color: #f8f9fa;
                }
                .category-row-redesigned .cat-name-cell {
                    background-image: linear-gradient(to right, var(--fill-color, transparent) var(--fill-pct, 0%), #ffffff var(--fill-pct, 0%));
                }
                .category-row-redesigned:hover .cat-name-cell {
                    background-image: linear-gradient(to right, var(--fill-color, transparent) var(--fill-pct, 0%), #f8f9fa var(--fill-pct, 0%)) !important;
                }
                .count-cell .drill-link {
                    color: #007bff;
                    text-decoration: underline;
                    font-weight: 700;
                }
                .count-cell .drill-link:hover {
                    color: #0056b3;
                }

                /* Zone Breakdown */
                .zone-breakdown-row-redesigned td {
                    padding: 0 !important;
                    background-color: #f8f9fa;
                }
                .zone-breakdown-container {
                    padding: 15px 25px;
                }
                .zone-breakdown-container table {
                    width: 100%;
                    text-align: center;
                    border-collapse: collapse;
                }
                .zone-breakdown-container th {
                    font-weight: 600;
                    font-size: 12px;
                    color: #495057;
                    padding-bottom: 8px;
                }
                .zone-breakdown-container td {
                    font-size: 14px;
                    font-weight: 700;
                    padding: 8px;
                    border: none;
                }

                /* Zone Breakdown Cards */
                .zone-breakdown-cards-container {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 10px;
                    padding: 10px 5px;
                }
                .zone-card {
                    background: #fff;
                    border: 1px solid #e0e1dd;
                    border-radius: 6px;
                    padding: 8px 12px;
                    text-align: center;
                    flex-grow: 1;
                    min-width: 90px;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
                }
                .zone-card-name {
                    font-size: 11px;
                    font-weight: 600;
                    color: #778da9;
                    margin-bottom: 2px;
                }
                .zone-card-count {
                    font-size: 18px;
                    font-weight: 700;
                    color: #1b263b;
                }
                .zone-drill-link {
                    cursor: pointer;
                    color: #007bff;
                }
                .zone-drill-link:hover {
                    text-decoration: underline;
                    color: #0056b3;
                }

                /* Disabled Zone Card */
                .disabled-zone-card {
                    background-color: #f8f9fa;
                    color: #adb5bd;
                    cursor: not-allowed;
                    opacity: 0.7;
                }
                .disabled-zone-card .zone-card-name {
                    color: #adb5bd;
                }
                .disabled-zone-card .zone-card-count span {
                    color: #adb5bd;
                    text-decoration: none;
                    cursor: not-allowed;
                }

                /* Category Percentage Share */
                .cat-name-wrapper {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                }
                .category-percentage-share {
                    font-size: 12px;
                    color: #6c757d;
                    font-weight: 400;
                    margin-left: 0;
                }

                /* Category Total Row */
                .category-table-redesigned tfoot {
                    border-top: 2px solid #3d7579;
                }
                .category-total-row {
                    background-color: #264a4d !important;
                }
                .category-total-row td {
                    font-weight: 700;
                    font-size: 15px;
                    color: #ffffff !important;
                    border-color: #3d7579 !important;
                }
                .total-movement-cell {
                    cursor: pointer;
                }

                @keyframes progress-bar-stripes {
                  from { background-position: 40px 0; }
                  to { background-position: 0 0; }
                }

                .progress-container-3d {
                    flex: 1;
                    height: 10px;
                    background-color: #e9ecef;
                    border-radius: 6px;
                    overflow: hidden;
                    box-shadow: inset 0 2px 4px rgba(0,0,0,0.2);
                    position: relative;
                    min-width: 30px;
                }

                .progress-bar-3d {
                    height: 100%;
                    border-radius: 8px;
                    transition: width 0.6s ease;
                    background-size: 40px 40px;
                    animation: progress-bar-stripes 2s linear infinite;
                    background-image: linear-gradient(45deg, rgba(255,255,255,.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.15) 50%, rgba(255,255,255,.15) 75%, transparent 75%, transparent);
                }

                /* Summary Cards Styles */
                .summary-cards-container {
                    display: flex;
                    gap: 10px;
                    margin-bottom: 12px;
                    padding: 2px 0;
                    flex-wrap: wrap;
                }
                .summary-card {
                    background: #fff;
                    border-radius: 8px;
                    padding: 4px 12px;
                    flex: 1;
                    min-width: 170px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
                    border: 1px solid #cbd5e1;
                    transition: transform 0.2s ease;
                }
                .summary-card:hover {
                    transform: translateY(-2px);
                }
                .summary-info {
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                }
                .summary-label {
                    font-size: 11px;
                    color: #64748b;
                    font-weight: 600;
                }
                .summary-value {
                    font-size: 18px;
                    font-weight: 800;
                    color: #1e293b;
                    letter-spacing: -0.3px;
                }
                .summary-subtext {
                    font-size: 10px;
                    font-weight: 600;
                    margin-top: 1px;
                }
                .summary-subtext.success { color: #10b981; }
                .summary-subtext.danger { color: #ef4444; }
                .summary-subtext.muted { color: #94a3b8; }
                
                .summary-icon-box {
                    width: 26px;
                    height: 26px;
                    background: linear-gradient(135deg, #417d81 0%, #346569 100%);
                    border-radius: 5px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: #fff;
                    font-size: 12px;
                    box-shadow: 0 2px 6px rgba(65, 125, 129, 0.1);
                }

                @keyframes redBlink {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.35; }
                }
                .days-left-blink {
                    color: #ef4444 !important;
                    font-weight: 700;
                    animation: redBlink 1s ease-in-out infinite;
                }

                /* MIS Dashboard & Toggle Custom Styles */
                .dashboard-header-toggle-wrapper {
                    position: absolute;
                    left: 50%;
                    top: 14px;
                    transform: translateX(-50%);
                    z-index: 100;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .dashboard-toggle-switch-container {
                    display: inline-flex;
                    align-items: center;
                    background: #f8fafc;
                    padding: 2px;
                    border-radius: 6px;
                    border: 1px solid #cbd5e1;
                    font-family: 'Inter', sans-serif;
                }
                .dashboard-toggle-btn {
                    border: none !important;
                    background: transparent !important;
                    padding: 4px 10px !important;
                    font-size: 11px !important;
                    font-weight: 600 !important;
                    color: #64748b !important;
                    border-radius: 4px !important;
                    cursor: pointer !important;
                    transition: all 0.15s ease-in-out !important;
                    box-shadow: none !important;
                    line-height: 1 !important;
                }
                .dashboard-toggle-btn.active {
                    background: #ffffff !important;
                    color: #417d81 !important;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
                }
                .dashboard-toggle-btn:hover:not(.active) {
                    color: #1e293b !important;
                }
                .mis-report-tab-btn {
                    padding: 6px 16px !important;
                    background: transparent !important;
                    border: none !important;
                    color: #64748b !important;
                    font-weight: 600 !important;
                    font-size: 13px !important;
                    cursor: pointer !important;
                    border-radius: 9999px !important;
                    transition: all 0.15s ease-in-out !important;
                    outline: none !important;
                    margin: 0 !important;
                }
                .mis-report-tab-btn.active {
                    background: #417d81 !important;
                    color: #ffffff !important;
                    font-weight: 700 !important;
                    box-shadow: 0 4px 10px rgba(65, 125, 129, 0.25) !important;
                }
                .mis-dropdown-item {
                    display: block !important;
                    width: 100% !important;
                    padding: 8px 12px !important;
                    background: transparent !important;
                    color: #1e293b !important;
                    border: none !important;
                    text-align: left !important;
                    font-size: 13px !important;
                    font-weight: 600 !important;
                    border-radius: 6px !important;
                    cursor: pointer !important;
                }
                .mis-dropdown-item.active {
                    background: #417d81 !important;
                    color: #fff !important;
                    font-weight: 700 !important;
                }
                .mis-dropdown-item:hover:not(.active) {
                    background: #f1f5f9 !important;
                }
                .mis-table-body tr:hover {
                    background-color: #f8fafc !important;
                }
                @media (max-width: 768px) {
                    .dashboard-header-toggle-wrapper {
                        position: static !important;
                        transform: none !important;
                        margin: 10px auto !important;
                        width: 100%;
                        justify-content: center;
                    }
                }
            </style>
        `;

		$("head").append(styles);
	}

	renderProductWiseTgtVsAchTable(filteredBranches) {
		const self = this;
		if (self.isProductTgtAchLoading) {
			return self.buildMisSkeletonTable("Loading Product Wise TGT VS ACH...");
		}
		const rawData = self.productTgtAchRawData || [];
		if (!rawData || rawData.length === 0) {
			return `
				<div style="text-align: center; padding: 50px; color: #778da9; font-size: 16px; font-family: 'Inter', sans-serif;">
					<div style="font-size: 48px; margin-bottom: 15px;">📭</div>
					<div style="font-weight: 600; margin-bottom: 8px;">No Product Wise TGT VS ACH data available</div>
				</div>
			`;
		}

		const allowedSolIds = new Set((filteredBranches || []).map(b => String(b.sol_id || b.sol || "").trim()));
		const filteredRaw = allowedSolIds.size > 0 
			? rawData.filter(r => allowedSolIds.has(String(r.sol_id || "").trim()))
			: rawData;

		const standardOrder = ["CASA", "DAM", "DD", "FD", "RD", "SMBG"];
		const rawProducts = Array.from(new Set(filteredRaw.map(r => r.product).filter(p => p && p !== "SHARE")));
		const ptaProducts = standardOrder.filter(p => rawProducts.includes(p)).concat(
			rawProducts.filter(p => !standardOrder.includes(p))
		);
		if (ptaProducts.length === 0) {
			ptaProducts.push("CASA", "DAM", "DD", "FD", "RD", "SMBG");
		}

		const zones = {};
		const grandProducts = {};
		ptaProducts.forEach(p => grandProducts[p] = { tgt: 0, ach: 0 });
		let grandTgt = 0;
		let grandAch = 0;

		filteredRaw.forEach(row => {
			const prod = row.product;
			if (prod === "SHARE") return;

			const z = row.zone || "Unknown Zone";
			const r = row.region || "Unknown Region";
			const d = row.district || "Unknown District";
			const solId = String(row.sol_id || "").trim();
			const bName = row.branch_name || solId;
			const tgt = parseFloat(row.tgt) || 0;
			const ach = parseFloat(row.ach) || 0;

			grandTgt += tgt;
			grandAch += ach;
			if (!grandProducts[prod]) grandProducts[prod] = { tgt: 0, ach: 0 };
			grandProducts[prod].tgt += tgt;
			grandProducts[prod].ach += ach;

			if (!zones[z]) zones[z] = { name: z, tgt: 0, ach: 0, products: {}, regions: {} };
			zones[z].tgt += tgt;
			zones[z].ach += ach;
			if (!zones[z].products[prod]) zones[z].products[prod] = { tgt: 0, ach: 0 };
			zones[z].products[prod].tgt += tgt;
			zones[z].products[prod].ach += ach;

			if (!zones[z].regions[r]) zones[z].regions[r] = { name: r, tgt: 0, ach: 0, products: {}, districts: {} };
			zones[z].regions[r].tgt += tgt;
			zones[z].regions[r].ach += ach;
			if (!zones[z].regions[r].products[prod]) zones[z].regions[r].products[prod] = { tgt: 0, ach: 0 };
			zones[z].regions[r].products[prod].tgt += tgt;
			zones[z].regions[r].products[prod].ach += ach;

			if (!zones[z].regions[r].districts[d]) zones[z].regions[r].districts[d] = { name: d, tgt: 0, ach: 0, products: {}, sols: {} };
			zones[z].regions[r].districts[d].tgt += tgt;
			zones[z].regions[r].districts[d].ach += ach;
			if (!zones[z].regions[r].districts[d].products[prod]) zones[z].regions[r].districts[d].products[prod] = { tgt: 0, ach: 0 };
			zones[z].regions[r].districts[d].products[prod].tgt += tgt;
			zones[z].regions[r].districts[d].products[prod].ach += ach;

			if (!zones[z].regions[r].districts[d].sols[solId]) {
				zones[z].regions[r].districts[d].sols[solId] = {
					sol_id: solId,
					branch_name: bName,
					tgt: 0,
					ach: 0,
					products: {}
				};
			}
			const solObj = zones[z].regions[r].districts[d].sols[solId];
			solObj.tgt += tgt;
			solObj.ach += ach;
			if (!solObj.products[prod]) solObj.products[prod] = { tgt: 0, ach: 0 };
			solObj.products[prod].tgt += tgt;
			solObj.products[prod].ach += ach;
		});

		const fmtAmt = (val) => {
			if (val === null || val === undefined || val === 0) return "-";
			const formatted = self.formatCurrency(val);
			if (formatted.startsWith("-")) {
				return "-₹" + formatted.substring(1);
			}
			return "₹" + formatted;
		};

		const fmtPct = (tgt, ach) => {
			if (!tgt || tgt <= 0) return "0%";
			return Math.round((ach / tgt) * 100) + "%";
		};

		const fmtGap = (tgt, ach) => {
			const gap = tgt - ach;
			return fmtAmt(gap);
		};

		const fmtGapPct = (tgt, ach) => {
			if (!tgt || tgt <= 0) return "0%";
			const gap = tgt - ach;
			return Math.round((gap / tgt) * 100) + "%";
		};

		if (!self.state.expandedPtaZones) self.state.expandedPtaZones = {};
		if (!self.state.expandedPtaRegions) self.state.expandedPtaRegions = {};
		if (!self.state.expandedPtaDistricts) self.state.expandedPtaDistricts = {};

		const renderProductCells = (pMap) => {
			return ptaProducts.map(p => {
				const item = pMap[p] || { tgt: 0, ach: 0 };
				const tgtStr = fmtAmt(item.tgt);
				const achStr = fmtAmt(item.ach);
				const pctStr = fmtPct(item.tgt, item.ach);

				let achSubText = "";
				if (item.ach > 0 || item.tgt > 0) {
					if (item.tgt > 0 && item.ach >= item.tgt) {
						achSubText = `<div style="font-size: 10px; color: #15803d; font-weight: 600; margin-top: 2px; white-space: nowrap;">↗ ${pctStr}</div>`;
					} else if (item.tgt > 0 && item.ach < item.tgt) {
						achSubText = `<div style="font-size: 10px; color: #b91c1c; font-weight: 600; margin-top: 2px; white-space: nowrap;">↓ ${pctStr}</div>`;
					} else {
						achSubText = `<div style="font-size: 10px; color: #64748b; font-weight: 500; margin-top: 2px; white-space: nowrap;">${pctStr}</div>`;
					}
				}

				return `
					<td data-product="${p}" data-type="tgt" style="text-align: right; padding: 8px 8px; border-left: 1px solid #cbd5e1; font-size: 12px; font-weight: 600; color: #1e293b; vertical-align: top; white-space: nowrap;">
						<div style="white-space: nowrap;">${tgtStr}</div>
					</td>
					<td data-product="${p}" data-type="ach" style="text-align: right; padding: 8px 8px; font-size: 12px; font-weight: 600; color: #1e293b; vertical-align: top; white-space: nowrap;">
						<div style="white-space: nowrap;">${achStr}</div>
						${achSubText}
					</td>
				`;
			}).join('');
		};

		const renderOverallCells = (tgt, ach) => {
			const gapRaw = tgt - ach;
			const tgtStr = fmtAmt(tgt);
			const achStr = fmtAmt(ach);
			const pctStr = fmtPct(tgt, ach);

			let gapHtml = "";
			if (gapRaw > 0) {
				gapHtml = `<div style="font-size: 10px; color: #b91c1c; font-weight: 600; margin-top: 2px; white-space: nowrap;">Gap: ${fmtGap(tgt, ach)} (${fmtGapPct(tgt, ach)})</div>`;
			} else {
				gapHtml = `<div style="font-size: 10px; color: #15803d; font-weight: 600; margin-top: 2px; white-space: nowrap;">Surplus: ${fmtAmt(Math.abs(gapRaw))}</div>`;
			}

			return `
				<td data-product="TOTAL" style="text-align: right; padding: 8px 10px; border-left: 2px solid #73a8aa; vertical-align: top; min-width: 150px; background: rgba(65,125,129,0.03); white-space: nowrap;">
					<div style="font-size: 11px; color: #475569; font-weight: 600; white-space: nowrap;">TGT: <span style="font-weight: 700; color: #1e293b;">${tgtStr}</span></div>
					<div style="font-size: 12px; font-weight: 800; color: #0f172a; margin-top: 2px; white-space: nowrap;">ACH: ${achStr} <span style="font-size: 11px; font-weight: 700; color: #0d9488;">(${pctStr})</span></div>
					${gapHtml}
				</td>
			`;
		};

		let rowsHtml = "";

		Object.keys(zones).sort().forEach(zoneName => {
			const zObj = zones[zoneName];
			const zoneExpanded = !!self.state.expandedPtaZones[zoneName];

			rowsHtml += `
				<tr class="pta-zone-row" data-zone="${zoneName}" style="cursor: pointer; background: #ffffff; font-weight: bold; border-bottom: 1px solid #cbd5e1;">
					<td style="text-align: center; width: 35px; vertical-align: middle;"><input type="checkbox" class="pta-row-checkbox" style="cursor: pointer; transform: scale(1.1);"></td>
					<td style="text-align: center; width: 60px; vertical-align: middle;"><span style="background: #64748b; color: white; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">Zone</span></td>
					<td class="pta-name-cell" style="text-align: left; padding-left: 6px; max-width: 140px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; vertical-align: middle;" title="${zoneName}">
						<span class="pta-toggle" style="margin-right: 4px; font-size: 10px; color: #475569;">${zoneExpanded ? "▼" : "▶"}</span>
						<strong style="color: #1e293b; font-size: 12px;">${zoneName}</strong>
					</td>
					${renderProductCells(zObj.products)}
					${renderOverallCells(zObj.tgt, zObj.ach)}
				</tr>
			`;

			Object.keys(zObj.regions).sort().forEach(regName => {
				const rObj = zObj.regions[regName];
				const regKey = zoneName + "::" + regName;
				const regExpanded = !!self.state.expandedPtaRegions[regKey];
				const showRegion = zoneExpanded;

				rowsHtml += `
					<tr class="pta-region-row" data-key="${regKey}" style="display: ${showRegion ? 'table-row' : 'none'}; cursor: pointer; background: #f8fafc; font-weight: 600; border-bottom: 1px solid #cbd5e1; border-left: 4px solid #417d81;">
						<td style="text-align: center; vertical-align: middle;"><input type="checkbox" class="pta-row-checkbox" style="cursor: pointer; transform: scale(1.1);"></td>
						<td style="text-align: center; vertical-align: middle;"><span style="background: #0d9488; color: white; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">Region</span></td>
						<td class="pta-name-cell" style="text-align: left; padding-left: 14px; max-width: 140px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: #334155; font-size: 12px; vertical-align: middle;" title="${regName}">
							<span class="pta-toggle" style="margin-right: 4px; font-size: 10px; color: #64748b;">${regExpanded ? "▼" : "▶"}</span>
							${regName}
						</td>
						${renderProductCells(rObj.products)}
						${renderOverallCells(rObj.tgt, rObj.ach)}
					</tr>
				`;

				Object.keys(rObj.districts).sort().forEach(distName => {
					const dObj = rObj.districts[distName];
					const distKey = regKey + "::" + distName;
					const distExpanded = !!self.state.expandedPtaDistricts[distKey];
					const showDist = zoneExpanded && regExpanded;

					rowsHtml += `
						<tr class="pta-district-row" data-key="${distKey}" style="display: ${showDist ? 'table-row' : 'none'}; cursor: pointer; background: #fafaf9; font-weight: 600; border-bottom: 1px solid #e7e5e4; border-left: 6px solid #64748b;">
							<td style="text-align: center; vertical-align: middle;"><input type="checkbox" class="pta-row-checkbox" style="cursor: pointer; transform: scale(1.1);"></td>
							<td style="text-align: center; vertical-align: middle;"><span style="background: #d97706; color: white; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">District</span></td>
							<td class="pta-name-cell" style="text-align: left; padding-left: 22px; max-width: 140px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: #44403c; font-size: 12px; vertical-align: middle;" title="${distName}">
								<span class="pta-toggle" style="margin-right: 4px; font-size: 10px; color: #78716c;">${distExpanded ? "▼" : "▶"}</span>
								${distName}
							</td>
							${renderProductCells(dObj.products)}
							${renderOverallCells(dObj.tgt, dObj.ach)}
						</tr>
					`;

					Object.keys(dObj.sols).sort().forEach(solId => {
						const solObj = dObj.sols[solId];
						const solKey = distKey + "::" + solId;
						const showSol = zoneExpanded && regExpanded && distExpanded;
						const solLabel = `${solObj.sol_id} - ${solObj.branch_name}`;

						rowsHtml += `
							<tr class="pta-sol-row" data-key="${solKey}" style="display: ${showSol ? 'table-row' : 'none'}; background: #ffffff; border-bottom: 1px solid #e2e8f0; border-left: 8px solid #cbd5e1;">
								<td style="text-align: center; vertical-align: middle;"><input type="checkbox" class="pta-row-checkbox" style="cursor: pointer; transform: scale(1.1);"></td>
								<td style="text-align: center; vertical-align: middle;"><span style="background: #4f46e5; color: white; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">SOL</span></td>
								<td class="pta-name-cell" style="text-align: left; padding-left: 30px; max-width: 140px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: #475569; font-weight: 500; font-size: 11px; vertical-align: middle;" title="${solLabel}">
									${solLabel}
								</td>
								${renderProductCells(solObj.products)}
								${renderOverallCells(solObj.tgt, solObj.ach)}
							</tr>
						`;
					});
				});
			});
		});

		const grandGapRaw = grandTgt - grandAch;

		return `
			<style>
				#product-tgt-ach-table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
				#product-tgt-ach-table th, #product-tgt-ach-table td { white-space: nowrap !important; }
				#product-tgt-ach-table thead { position: sticky; top: 0; z-index: 20; }
				#product-tgt-ach-table thead tr.main-hdr { background: linear-gradient(180deg, #417d81 0%, #346569 100%) !important; color: #ffffff !important; }
				#product-tgt-ach-table thead tr.sub-hdr { background-color: #315e61 !important; color: #ffffff !important; font-size: 11px; font-weight: 700; }
				#product-tgt-ach-table thead th { border-bottom: 1px solid #264a4d !important; border-right: 1px solid rgba(255, 255, 255, 0.2) !important; }
				#product-tgt-ach-table tfoot { position: sticky; bottom: 0; z-index: 20; }
				#product-tgt-ach-table tfoot tr { background-color: #264a4d !important; color: #ffffff !important; font-weight: 800; box-shadow: 0 -2px 6px rgba(0,0,0,0.15); }
				#product-tgt-ach-table tbody tr:hover { background-color: #f0f9ff !important; }
				#product-tgt-ach-table td.pta-cell-highlight { background-color: #7dd3fc !important; color: #0c4a6e !important; box-shadow: inset 0 0 0 2px #0284c7 !important; transition: background-color 0.12s ease; }
				#product-tgt-ach-table td.pta-name-highlight { background-color: #bae6fd !important; color: #0369a1 !important; font-weight: 700 !important; box-shadow: inset 0 0 0 1px #38bdf8 !important; transition: background-color 0.12s ease; }
				#product-tgt-ach-table th.pta-header-highlight { background: #0284c7 !important; color: #ffffff !important; box-shadow: inset 0 0 0 2px #38bdf8, 0 4px 6px rgba(0,0,0,0.2) !important; font-weight: 900 !important; transition: background-color 0.12s ease; }
				#product-tgt-ach-table tbody tr.pta-row-selected { background-color: #fef3c7 !important; font-weight: 600; }
			</style>
			<div style="overflow-x: auto; max-height: 75vh; overflow-y: auto;">
				<table id="product-tgt-ach-table" class="table table-bordered">
					<thead>
						<tr class="main-hdr">
							<th rowspan="2" style="width: 35px; text-align: center; vertical-align: middle;"><input type="checkbox" class="pta-select-all" style="cursor: pointer; transform: scale(1.1);" title="Select All"></th>
							<th rowspan="2" style="width: 60px; text-align: center; vertical-align: middle; font-weight: 700; font-size: 11px;">Level</th>
							<th rowspan="2" style="width: 140px; min-width: 130px; max-width: 150px; text-align: left; padding-left: 8px; vertical-align: middle; font-weight: 700;">Z / R / D / SOL</th>
							${ptaProducts.map(p => `<th data-product="${p}" colspan="2" style="text-align: center; border-left: 1px solid rgba(255, 255, 255, 0.2); font-weight: 800; font-size: 13px; padding: 6px 4px;">${p}</th>`).join('')}
							<th data-product="TOTAL" rowspan="2" style="text-align: center; border-left: 2px solid rgba(255, 255, 255, 0.4); background: #264a4d; font-weight: 800; font-size: 13px; padding: 6px 8px; vertical-align: middle; width: 150px; min-width: 140px;">OVERALL TOTAL</th>
						</tr>
						<tr class="sub-hdr">
							${ptaProducts.map(p => `
								<th style="width: 85px; min-width: 80px; text-align: center; padding: 4px 6px; border-left: 1px solid rgba(255, 255, 255, 0.15); white-space: nowrap;">TGT</th>
								<th style="width: 95px; min-width: 90px; text-align: center; padding: 4px 6px; white-space: nowrap;">ACH</th>
							`).join('')}
						</tr>
					</thead>
					<tbody>
						${rowsHtml}
					</tbody>
					<tfoot>
						<tr style="background-color: #264a4d !important; color: #ffffff !important; font-weight: 800; font-size: 12px;">
							<td></td>
							<td></td>
							<td style="text-align: left; padding-left: 8px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; white-space: nowrap;">TOTAL</td>
							${ptaProducts.map(p => {
								const item = grandProducts[p] || { tgt: 0, ach: 0 };
								const pctStr = fmtPct(item.tgt, item.ach);
								return `
									<td data-product="${p}" data-type="tgt" style="text-align: right; padding: 8px 8px; border-left: 1px solid rgba(255, 255, 255, 0.2); font-size: 12px; font-weight: 700; color: #ffffff; vertical-align: top; white-space: nowrap;">${fmtAmt(item.tgt)}</td>
									<td data-product="${p}" data-type="ach" style="text-align: right; padding: 8px 8px; border-left: 1px solid rgba(255, 255, 255, 0.2); font-size: 12px; font-weight: 700; color: #ffffff; vertical-align: top; white-space: nowrap;">
										<div style="white-space: nowrap;">${fmtAmt(item.ach)}</div>
										<div style="font-size: 10px; color: #5eead4; font-weight: 600; margin-top: 2px; white-space: nowrap;">${pctStr}</div>
									</td>
								`;
							}).join('')}
							<td data-product="TOTAL" style="text-align: right; padding: 8px 10px; border-left: 2px solid rgba(255, 255, 255, 0.4); vertical-align: top; white-space: nowrap;">
								<div style="font-size: 11px; color: #cbd5e1; font-weight: 600; white-space: nowrap;">TGT: <span style="font-weight: 800; color: #ffffff;">${fmtAmt(grandTgt)}</span></div>
								<div style="font-size: 12px; font-weight: 800; color: #ffffff; margin-top: 2px; white-space: nowrap;">ACH: ${fmtAmt(grandAch)} <span style="font-size: 11px; font-weight: 700; color: #5eead4;">(${fmtPct(grandTgt, grandAch)})</span></div>
								<div style="font-size: 10px; color: ${grandGapRaw > 0 ? '#fca5a5' : '#6ee7b7'}; font-weight: 700; margin-top: 2px; white-space: nowrap;">Gap: ${fmtGap(grandTgt, grandAch)} (${fmtGapPct(grandTgt, grandAch)})</div>
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
		`;
	}

	attachProductTgtAchExpandHandlers() {
		const self = this;
		const container = this.page.main.find("#data-container");

		container.off("click", ".pta-row-checkbox").on("click", ".pta-row-checkbox", function (e) {
			e.stopPropagation();
		});

		container.off("change", ".pta-row-checkbox").on("change", ".pta-row-checkbox", function (e) {
			e.stopPropagation();
			const $tr = $(this).closest("tr");
			if ($(this).is(":checked")) {
				$tr.addClass("pta-row-selected");
			} else {
				$tr.removeClass("pta-row-selected");
			}
		});

		container.off("click", ".pta-select-all").on("click", ".pta-select-all", function (e) {
			e.stopPropagation();
		});

		container.off("change", ".pta-select-all").on("change", ".pta-select-all", function (e) {
			e.stopPropagation();
			const isChecked = $(this).is(":checked");
			const $rows = container.find("#product-tgt-ach-table tbody tr");
			$rows.find(".pta-row-checkbox").prop("checked", isChecked);
			if (isChecked) {
				$rows.addClass("pta-row-selected");
			} else {
				$rows.removeClass("pta-row-selected");
			}
		});

		container.off("mouseenter mouseleave", "#product-tgt-ach-table tbody td")
			.on("mouseenter", "#product-tgt-ach-table tbody td", function () {
				const $td = $(this);
				const $tr = $td.closest("tr");
				const prod = $td.attr("data-product");

				$("#product-tgt-ach-table .pta-cell-highlight, #product-tgt-ach-table .pta-header-highlight, #product-tgt-ach-table .pta-name-highlight").removeClass("pta-cell-highlight pta-header-highlight pta-name-highlight");

				$tr.find(".pta-name-cell").addClass("pta-name-highlight");

				if (prod) {
					$tr.find(`td[data-product="${prod}"]`).addClass("pta-cell-highlight");
					$(`#product-tgt-ach-table thead th[data-product="${prod}"]`).addClass("pta-header-highlight");
				}
			})
			.on("mouseleave", "#product-tgt-ach-table", function () {
				$("#product-tgt-ach-table .pta-cell-highlight, #product-tgt-ach-table .pta-header-highlight, #product-tgt-ach-table .pta-name-highlight").removeClass("pta-cell-highlight pta-header-highlight pta-name-highlight");
			});

		container.off("click", ".pta-zone-row").on("click", ".pta-zone-row", function (e) {
			if ($(e.target).is(".pta-row-checkbox")) return;
			const zone = $(this).data("zone");
			self.state.expandedPtaZones[zone] = !self.state.expandedPtaZones[zone];
			self.render();
		});

		container.off("click", ".pta-region-row").on("click", ".pta-region-row", function (e) {
			if ($(e.target).is(".pta-row-checkbox")) return;
			const key = $(this).data("key");
			self.state.expandedPtaRegions[key] = !self.state.expandedPtaRegions[key];
			self.render();
		});

		container.off("click", ".pta-district-row").on("click", ".pta-district-row", function (e) {
			if ($(e.target).is(".pta-row-checkbox")) return;
			const key = $(this).data("key");
			self.state.expandedPtaDistricts[key] = !self.state.expandedPtaDistricts[key];
			self.render();
		});

		container.off("click", ".pta-sol-row").on("click", ".pta-sol-row", function (e) {
			if ($(e.target).is(".pta-row-checkbox")) return;
			const key = $(this).data("key");
			self.state.expandedPtaSols[key] = !self.state.expandedPtaSols[key];
			self.render();
		});
	}

}
