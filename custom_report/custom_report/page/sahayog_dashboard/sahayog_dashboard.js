frappe.pages["sahayog_dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "DRISHTI",
		single_column: true,
	});

	new SahayogDashboard(page);
};

class SahayogDashboard {
	constructor(page) {
		this.page = page;
		this.isComparisonPopupOpen = false;
		// Data state
		this.data = null;
		this.rawData = null;
		this.allDrillData = [];
		this.drillDownFilters = { sol: "", zone: "all", region: "all" };
		this.availableDates = [];
		this.selectedDate = null;
		this.availableZones = [];
		this.availableCategories = [];

		// Filter state
		this.filters = {
			zones: new Set(),
			categories: new Set(),
		};

		// Target type: Monthly | Yearly | YTD (default Monthly)
		this.targetType = "Monthly";

		// UI state
		this.collapsedGroups = new Set();
		this.collapsedSegments = new Set([1, 2, 3, 4]);
		this.currentView = "dashboard";
		this.groupBy = "zone";
		// Comparison state: daily | weekly | monthly
		this.comparisonMode = "daily";
		this.comparisonResult = null;
		this.allExpanded = false;
		this.chartInstance = null;

		// Drill-down context
		this.currentZone = null;
		this.currentCategory = null;

		// Helpers
		this.dateSelectTimer = null;
		this.chartInstance = null;

		this.loadState();
		this.loadECharts();
		this.init();
	}

	// Load comparison data from backend for current selected date, mode and filters
	loadComparisonData() {
		if (!this.selectedDate) return;

		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_comparison_data",
			args: {
				current_date: this.selectedDate,
				mode: this.comparisonMode,
				filters: this.getFiltersJSON(),
				target_type: this.targetType,
			},
			callback: (r) => {
				if (r.message) {
					this.comparisonResult = r.message;
					// Update chips and re-render overlay indicators
					this.updateFilterIndicator();
					if (this.rawData) {
						this.updateCategoryCounts(this.rawData);
						this.renderDashboard(this.rawData);
					}
				}
			},
		});
	}

	// Helper: find comparison row for a specific zone+category
	findComparisonRow(zone, category) {
		if (!this.comparisonResult || !this.comparisonResult.comparison_rows) return null;
		const rows = this.comparisonResult.comparison_rows;
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			if (
				(r.zone || "Unknown") === (zone || "Unknown") &&
				(r.category || "Unknown") === (category || "Unknown")
			) {
				return r;
			}
		}
		return null;
	}

	// Helper: compute aggregate comparison indicator for a group (zone or category)
	computeGroupIndicator(label, type) {
		if (!this.comparisonResult || !this.comparisonResult.comparison_rows) return null;
		let cur = 0;
		let prev = 0;
		this.comparisonResult.comparison_rows.forEach((r) => {
			if (type === "zone" && r.zone === label) {
				cur += r.current_branch_count || 0;
				prev += r.previous_branch_count || 0;
			} else if (type === "category" && r.category === label) {
				cur += r.current_branch_count || 0;
				prev += r.previous_branch_count || 0;
			}
		});
		const diff = cur - prev;
		if (diff > 0) return { indicator: "▲", diff, color: "green", display: `+${diff}` };
		if (diff < 0) return { indicator: "▼", diff, color: "red", display: `${diff}` };
		return { indicator: "→", diff: 0, color: "grey", display: "0" };
	}

	// Show zone-wise breakdown for a specific category in table
	showCategoryBreakdownTable(category) {
		if (!this.rawData) return;

		const tbody = $("#dashboard-tbody");
		tbody.empty();

		let totalData = {
			branch_count: 0,
			dec: { tgt: 0, ach: 0, available: false },
			jan: { tgt: 0, ach: 0, available: false },
			feb: { tgt: 0, ach: 0, available: false },
			mar: { tgt: 0, ach: 0, available: false },
			total: { tgt: 0, ach: 0 },
		};

		// Build rows for each zone showing this category
		this.rawData.zones.forEach((zone) => {
			zone.categories.forEach((cat) => {
				if (cat.category === category) {
					const cmp = this.findComparisonRow(zone.zone, category);
					let cmpHtml = "";
					if (cmp) {
						const indicatorClass =
							cmp.difference !== 0 ? "cmp-indicator-clickable" : "";
						cmpHtml = ` <span class="cmp-indicator ${
							cmp.indicator_color
						} ${indicatorClass}" style="${
							cmp.difference !== 0 ? "cursor:pointer;" : ""
						}" data-zone="${zone.zone}" data-category="${category}" data-diff="${
							cmp.difference
						}">${cmp.indicator} ${cmp.difference_display}</span>`;
					}

					tbody.append(`
							<tr class="child-row cat-${category.replace(/\s+/g, "-").toLowerCase()}" data-zone="${
						zone.zone
					}" data-category="${category}">
								<td class="row-label">${zone.zone}</td>
								<td style="cursor:pointer; color:#000; font-weight:700;">${cat.branch_count}${cmpHtml}</td>
								<td>${this.formatTgtAch(cat.dec)}</td>
								<td>${this.formatTgtAch(cat.jan)}</td>
								<td>${this.formatTgtAch(cat.feb)}</td>
								<td>${this.formatTgtAch(cat.mar)}</td>
								<td>${this.formatTgtAch(cat.total)}</td>
							</tr>
						`);

					// Accumulate totals
					totalData.branch_count += cat.branch_count || 0;
					totalData.dec.tgt += cat.dec?.tgt || 0;
					totalData.dec.ach += cat.dec?.ach || 0;
					totalData.dec.available = totalData.dec.available || cat.dec?.available;
					totalData.jan.tgt += cat.jan?.tgt || 0;
					totalData.jan.ach += cat.jan?.ach || 0;
					totalData.jan.available = totalData.jan.available || cat.jan?.available;
					totalData.feb.tgt += cat.feb?.tgt || 0;
					totalData.feb.ach += cat.feb?.ach || 0;
					totalData.feb.available = totalData.feb.available || cat.feb?.available;
					totalData.mar.tgt += cat.mar?.tgt || 0;
					totalData.mar.ach += cat.mar?.ach || 0;
					totalData.mar.available = totalData.mar.available || cat.mar?.available;
					totalData.total.tgt += cat.total?.tgt || 0;
					totalData.total.ach += cat.total?.ach || 0;
				}
			});
		});

		// Add grand total for this category
		if (totalData.branch_count > 0) {
			$("#dashboard-tfoot").html(this.createGrandTotalRow(totalData));
		}

		// Attach row click events
		this.attachRowEvents();
	}

	loadECharts() {
		if (!window.echarts) {
			const script = document.createElement("script");
			script.src = "https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js";
			script.onload = () => console.log("ECharts loaded");
			document.head.appendChild(script);
		}
	}

	init() {
		this.setupStyles();
		this.createFixedHeader();
		this.loadAvailableDates();

		// Delegated hover event for comparison popups
		$(document).on("mouseenter", ".cmp-indicator-clickable", (e) => {
			const target = $(e.currentTarget);
			const zone = target.data("zone") || target.attr("data-zone");
			const category = target.data("category") || target.attr("data-category");
			const diff = target.data("diff") || target.attr("data-diff");

			console.log("🖱️ Hover on comparison indicator:", { zone, category, diff });

			if (diff != 0) {
				this.showComparisonDetailPopup(zone, category);
			}
		});

		// Click handler for branch name to open branch profile
		$(document).on("click", ".branch-name-cell", (e) => {
			const sol_id = $(e.currentTarget).data("sol-id");
			if (sol_id) {
				this.openBranchProfile(sol_id);
			}
		});
	}

	saveState() {
		const state = {
			selectedDate: this.selectedDate,
			groupBy: this.groupBy,
			comparisonMode: this.comparisonMode,
			targetType: this.targetType,
			filters: {
				zones: Array.from(this.filters.zones),
				categories: Array.from(this.filters.categories),
			},
		};
		localStorage.setItem("sahayog_dashboard_state", JSON.stringify(state));
	}

	loadState() {
		const saved = localStorage.getItem("sahayog_dashboard_state");
		if (!saved) return;

		try {
			const state = JSON.parse(saved);
			this.selectedDate = state.selectedDate || null;
			this.groupBy = state.groupBy || "zone";
			this.comparisonMode = state.comparisonMode || "daily";
			this.targetType = state.targetType || "Monthly";

			if (state.filters) {
				this.filters.zones = new Set(state.filters.zones || []);
				this.filters.categories = new Set(state.filters.categories || []);
			}
		} catch (e) {
			console.error("Failed to load state:", e);
		}
	}

	loadAvailableDates() {
		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_available_dates",
			callback: (r) => {
				if (r.message && r.message.length > 0) {
					this.availableDates = r.message;

					if (!this.selectedDate) {
						this.selectedDate = this.availableDates[0].date;
					}

					// Default week start = Monday of the week that contains the selected/latest date
					this.weekStartDate = this.getWeekStart(this.selectedDate);

					this.loadAvailableZones();
				} else {
					frappe.msgprint(
						"No data available. Please import Branch Category Report records."
					);
				}
			},
		});
	}

	loadAvailableZones() {
		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_available_zones",
			callback: (r) => {
				this.availableZones = r.message || [];
				this.loadAvailableCategories();
			},
		});
	}

	loadAvailableCategories() {
		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_available_categories",
			callback: (r) => {
				this.availableCategories = r.message || [];
				this.createCombinedFilters();
				this.createActiveFilterIndicator();
				this.createContentArea();
				this.createChartModal();
				this.createDrillDownView();
				this.loadView("dashboard");
			},
		});
	}

	// Create compact timeline in table header
	createCompactTimeline() {
		const timelineHtml = `
			<div class="timeline-container">
				<div class="compact-timeline">
					<button class="week-nav-btn" id="week-prev">◀</button>
					<div class="timeline-dates-compact" id="timeline-dates-compact"></div>
					<button class="week-nav-btn" id="week-next">▶</button>
				</div>
			</div>
		`;

		const container = $(timelineHtml);
		const datesContainer = container.find("#timeline-dates-compact");

		// Ensure we have a weekStartDate
		if (!this.weekStartDate) {
			this.weekStartDate = this.getWeekStart(
				this.selectedDate || (this.availableDates[0] && this.availableDates[0].date)
			);
		}

		// Render the week (Mon - Sat)
		this.renderWeekInTimeline(datesContainer, this.weekStartDate);

		// Prev / Next handlers
		container.find("#week-prev").on("click", () => {
			this.weekStartDate = this.addDays(this.weekStartDate, -7);
			this.renderWeekInTimeline(datesContainer, this.weekStartDate);
			console.log("Week changed to:", this.weekStartDate);
		});

		container.find("#week-next").on("click", () => {
			this.weekStartDate = this.addDays(this.weekStartDate, 7);
			this.renderWeekInTimeline(datesContainer, this.weekStartDate);
			console.log("Week changed to:", this.weekStartDate);
		});

		return container;
	}

	selectDate(date) {
		this.selectedDate = date;
		// Keep timeline focused on the week of the selected date
		this.weekStartDate = this.getWeekStart(date);

		$(".timeline-date-compact").removeClass("selected");
		$(`.timeline-date-compact[data-date="${date}"]`).addClass("selected");

		// Debounce rapid clicks to avoid multiple API calls
		if (this.dateSelectTimer) clearTimeout(this.dateSelectTimer);
		this.dateSelectTimer = setTimeout(() => {
			this.saveState();
			this.updateFilterIndicator();
			this.loadDashboardData();
			this.dateSelectTimer = null;
		}, 220);
	}

	// Helpers for week rendering and date manipulation
	formatDateISO(d) {
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, "0");
		const dd = String(d.getDate()).padStart(2, "0");
		return `${yyyy}-${mm}-${dd}`;
	}

	getWeekStart(dateStr) {
		// Return ISO date string for Monday of the week containing dateStr
		const d = new Date(dateStr);
		// Compute diff to Monday: Monday should be 0 offset
		const diff = (d.getDay() + 6) % 7; // 0->Mon, 6->Sun maps to 6
		d.setDate(d.getDate() - diff);
		return this.formatDateISO(d);
	}

	addDays(dateStr, offset) {
		const d = new Date(dateStr);
		d.setDate(d.getDate() + offset);
		return this.formatDateISO(d);
	}

	renderWeekInTimeline(datesContainer, weekStartIso) {
		// weekStartIso is ISO string for Monday
		datesContainer.empty();
		const availableSet = new Set((this.availableDates || []).map((d) => d.date));

		for (let i = 0; i < 6; i++) {
			const d = new Date(weekStartIso);
			d.setDate(d.getDate() + i);
			const iso = this.formatDateISO(d);
			const dayName = d.toLocaleDateString(undefined, { weekday: "short" });
			const dayNum = d.getDate();
			const isAvailable = availableSet.has(iso);
			const isSelected = iso === this.selectedDate;

			const item = $(
				`<div class="timeline-date-compact ${isSelected ? "selected" : ""} ${
					isAvailable ? "" : "disabled"
				}" data-date="${iso}" title="${dayName} ${dayNum}">
					<div class="timeline-day-compact">${dayName}</div>
					<div class="timeline-num-compact">${dayNum}</div>
				</div>`
			);

			if (isAvailable) {
				item.on("click", () => this.selectDate(iso));
			} else {
				item.css({ opacity: 0.45, cursor: "default" });
			}

			datesContainer.append(item);
		}

		// Scroll selected into center if present
		setTimeout(() => {
			const parent = datesContainer.get(0);
			const sel = datesContainer.find(".timeline-date-compact.selected").get(0);
			if (parent && sel) {
				const parentWidth = parent.clientWidth;
				const targetLeft = sel.offsetLeft + sel.offsetWidth / 2 - parentWidth / 2;
				parent.scrollTo({ left: targetLeft, behavior: "smooth" });
			}
		}, 40);
	}

	getFiltersJSON() {
		const filters = {
			zones: Array.from(this.filters.zones),
			categories: Array.from(this.filters.categories),
		};
		return JSON.stringify(filters);
	}

	hasActiveFilters() {
		return this.filters.zones.size > 0 || this.filters.categories.size > 0;
	}

	createCombinedFilters() {
		const filtersHtml = `
				<div class="combined-filters">
					<div class="filter-section">
						<div class="filter-section-label">
							<i class="fa fa-map-marker-alt" style="font-size: 9px;"></i> ZONE
						</div>
						<div class="filter-chips" id="zone-chips">
							<div class="filter-chip ${this.filters.zones.size === 0 ? "active" : ""}" data-zone="all">
								All <span class="chip-count zone-count-all">0</span>
							</div>
						</div>
					</div>

					<div class="filter-section">
						<div class="filter-section-label">
							<i class="fa fa-layer-group" style="font-size: 9px;"></i> PERFORMANCE CATEGORIES
						</div>
						<div class="filter-chips">
							<div class="filter-chip ${this.filters.categories.size === 0 ? "active" : ""}" data-category="all">
								All <span class="chip-count" id="count-all">0</span>
							</div>
						</div>
					</div>

					<div class="filter-section" style="text-align: right; margin-top: 8px;">
						<button class="clear-filters-btn" id="clear-all-filters">
							<i class="fa fa-times-circle"></i> Clear All Filters
						</button>
					</div>
				</div>
			`;
		$(filtersHtml).appendTo(this.page.main);

		// Comparison button events
		$(document).on("click", ".comparison-btn", (e) => {
			const btn = $(e.currentTarget);
			const mode = btn.data("mode");
			$(".comparison-btn").removeClass("active");
			btn.addClass("active");
			this.comparisonMode = mode;
			this.saveState();
			// Refresh comparison data and UI
			this.loadComparisonData();
			this.loadDashboardData();
		});

		this.loadZoneChips();
		this.loadCategoryChips();
		$(document).on("click", ".filter-chip[data-zone]", (e) => {
			const chip = $(e.currentTarget);
			const zone = chip.data("zone");
			this.toggleZoneFilter(zone, chip);
		});

		$(document).on("click", ".filter-chip[data-category]", (e) => {
			const chip = $(e.currentTarget);
			const category = chip.data("category");
			this.toggleCategoryFilter(category, chip);
		});

		$(document).on("click", ".filter-chip[data-category] .chip-count", (e) => {
			e.stopPropagation();
			const chip = $(e.currentTarget).closest(".filter-chip");
			const category = chip.data("category");
			if (!category || category === "all") {
				frappe.show_alert({
					message: "Please select a specific category",
					indicator: "orange",
				});
				return;
			}
			// Show category breakdown in table view
			this.showCategoryBreakdownTable(category);
		});

		$("#clear-all-filters").on("click", () => this.clearAllFilters());
	}

	loadZoneChips() {
		const container = $("#zone-chips");

		// Add All zone chip if not already present
		if (!container.find('[data-zone="all"]').length) {
			container.append(`
					<div class="filter-chip ${this.filters.zones.size === 0 ? "active" : ""}" data-zone="all">
						All <span class="chip-count zone-count-all">0</span>
					</div>
				`);
		}

		this.availableZones.forEach((zoneName) => {
			const isActive = this.filters.zones.has(zoneName) ? "active" : "";
			container.append(`
					<div class="filter-chip ${isActive}" data-zone="${zoneName}">
						${zoneName}
						<span class="chip-count zone-count-${zoneName.replace(/\s+/g, "-")}">0</span>
					</div>
				`);
		});
	}

	loadCategoryChips() {
		const container = $("#zone-chips").parent().next().find(".filter-chips");

		// Add All category chip if not already present
		if (!container.find('[data-category="all"]').length) {
			container.append(`
					<div class="filter-chip ${this.filters.categories.size === 0 ? "active" : ""}" data-category="all">
						All <span class="chip-count" id="count-all">0</span>
					</div>
				`);
		}

		const categoryColors = {
			Pinnacle: "pinnacle",
			Master: "master",
			Accelerator: "accelerator",
			Starter: "starter",
			Learner: "learner",
			"Zero Level": "zero-level",
		};

		this.availableCategories.forEach((category) => {
			const isActive = this.filters.categories.has(category) ? "active" : "";
			const colorClass = categoryColors[category] || "";

			container.append(`
					<div class="filter-chip ${colorClass} ${isActive}" data-category="${category}">
						${category}
						<span class="chip-count" id="count-${category.replace(/\s+/g, "-").toLowerCase()}">0</span>
					</div>
				`);
		});
	}

	toggleZoneFilter(zone, chip) {
		if (zone === "all") {
			$(".filter-chip[data-zone]").removeClass("active");
			chip.addClass("active");
			this.filters.zones.clear();
		} else {
			$('.filter-chip[data-zone="all"]').removeClass("active");
			chip.toggleClass("active");

			if (chip.hasClass("active")) {
				this.filters.zones.add(zone);
			} else {
				this.filters.zones.delete(zone);
			}

			if (this.filters.zones.size === 0) {
				$('.filter-chip[data-zone="all"]').addClass("active");
			}
		}

		this.saveState();
		this.updateFilterIndicator();
		this.loadDashboardData();
	}

	toggleCategoryFilter(category, chip) {
		if (category === "all") {
			$(".filter-chip[data-category]").removeClass("active");
			chip.addClass("active");
			this.filters.categories.clear();
		} else {
			$('.filter-chip[data-category="all"]').removeClass("active");
			chip.toggleClass("active");

			if (chip.hasClass("active")) {
				this.filters.categories.add(category);
			} else {
				this.filters.categories.delete(category);
			}

			if (this.filters.categories.size === 0) {
				$('.filter-chip[data-category="all"]').addClass("active");
			}
		}

		this.saveState();
		this.updateFilterIndicator();
		this.loadDashboardData();
	}

	clearAllFilters() {
		this.filters.zones.clear();
		this.filters.categories.clear();

		$(".filter-chip[data-zone]").removeClass("active");
		$('.filter-chip[data-zone="all"]').addClass("active");

		$(".filter-chip[data-category]").removeClass("active");
		$('.filter-chip[data-category="all"]').addClass("active");

		this.saveState();
		this.updateFilterIndicator();
		this.loadDashboardData();
	}

	createActiveFilterIndicator() {
		const indicatorHtml = `
				<div class="active-filter-indicator" id="filter-indicator">
					<div class="filter-indicator-text" id="filter-indicator-text"></div>
				</div>
			`;
		$(indicatorHtml).appendTo(this.page.main);
		this.updateFilterIndicator();
	}

	updateFilterIndicator() {
		const indicator = $("#filter-indicator");
		const text = $("#filter-indicator-text");
		const parts = [];

		const selectedDateObj = this.availableDates.find((d) => d.date === this.selectedDate);
		if (selectedDateObj) {
			parts.push(`<span class="filter-badge">${selectedDateObj.display_full}</span>`);
		}

		// Add comparison mode badge
		if (this.comparisonMode) {
			const modeLabel =
				this.comparisonMode.charAt(0).toUpperCase() + this.comparisonMode.slice(1);
			parts.push(
				`<span class="filter-badge" style="background:rgba(99, 102, 241, 0.2); color:#4f46e5;">Compare: ${modeLabel}</span>`
			);
		}

		if (this.filters.zones.size > 0) {
			const zoneList = Array.from(this.filters.zones).join(", ");
			parts.push(`Zones: <span class="filter-badge">${zoneList}</span>`);
		}

		if (this.filters.categories.size > 0) {
			const catList = Array.from(this.filters.categories).join(", ");
			parts.push(`Categories: <span class="filter-badge">${catList}</span>`);
		}

		if (parts.length > 0) {
			text.html(`Active Filters: ${parts.join(" • ")}`);
			indicator.addClass("show");
		} else {
			text.html(`Viewing <span class="filter-badge">ALL DATA</span>`);
			indicator.removeClass("show");
		}
	}

	updateCategoryCounts(data) {
		if (!data) return;

		const counts = {};
		const zoneCounts = {};

		// Initialize counts
		this.availableCategories.forEach((cat) => {
			counts[cat] = 0;
		});
		counts["All"] = 0;

		this.availableZones.forEach((zone) => {
			zoneCounts[zone] = 0;
		});
		zoneCounts["All"] = 0;

		// Calculate counts from data
		data.zones?.forEach((zone) => {
			zoneCounts[zone.zone] = (zoneCounts[zone.zone] || 0) + (zone.branch_count || 0);
			zoneCounts["All"] += zone.branch_count || 0;

			zone.categories?.forEach((cat) => {
				counts[cat.category] = (counts[cat.category] || 0) + (cat.branch_count || 0);
				counts["All"] += cat.branch_count || 0;
			});
		});

		// Update UI
		Object.keys(counts).forEach((cat) => {
			const element = $(`#count-${cat.replace(/\s+/g, "-").toLowerCase()}`);
			if (element.length) {
				let indicatorHtml = "";
				if (this.comparisonResult) {
					const g = this.computeGroupIndicator(cat, "category");
					if (g) {
						indicatorHtml = ` <span class="cmp-indicator ${g.color}">${g.indicator} ${g.display}</span>`;
					}
				}
				element.html(`${counts[cat]}${indicatorHtml}`);
			}
		});

		Object.keys(zoneCounts).forEach((zone) => {
			const element = $(`.zone-count-${zone.replace(/\s+/g, "-")}`);
			if (element.length) {
				element.html(`${zoneCounts[zone]}`);
			}
		});
	}

	setupStyles() {
		// Keep your existing CSS styles here (they're comprehensive and good)
		// Due to length, I'm not repeating all CSS, but you should keep your existing styles
		const styles = `
				<style>
					/* Compact Timeline in Table Header */
					.compact-timeline {
						display: inline-flex;
						align-items: center;
						gap: 4px;
					}
					.timeline-dates-compact {
						display: inline-flex;
						gap: 4px;
						overflow-x: auto;
						max-width: 100%;
						padding: 2px;
					}
					.timeline-dates-compact::-webkit-scrollbar {
						height: 4px;
					}
					.timeline-dates-compact::-webkit-scrollbar-thumb {
						background: rgba(0,0,0,0.2);
						border-radius: 2px;
					}
					.timeline-date-compact {
						display: flex;
						flex-direction: column;
						align-items: center;
						justify-content: center;
						min-width: 42px;
						padding: 4px 6px;
						background: rgba(255,255,255,0.7);
						border: 1.5px solid #cbd5e1;
						border-radius: 6px;
						cursor: pointer;
						transition: all 0.2s;
					}
					.timeline-date-compact:hover {
						background: white;
						border-color: #94a3b8;
						transform: translateY(-1px);
					}
					.timeline-date-compact.selected {
						background: #000;
						border-color: #000;
						color: white;
						box-shadow: 0 2px 6px rgba(0,0,0,0.2);
					}
					.week-nav-btn {
						background: rgba(0,0,0,0.6);
						color: white;
						border: none;
						padding: 6px 8px;
						border-radius: 6px;
						cursor: pointer;
						font-weight: 700;
					}
					.week-nav-btn:hover { background: rgba(255,255,255,0.06); }
					.timeline-date-compact.disabled { opacity: 0.45; }
					.timeline-day-compact {
						font-size: 8px;
						font-weight: 600;
						text-transform: uppercase;
						letter-spacing: 0.3px;
						opacity: 0.7;
					}
					.timeline-date-compact.selected .timeline-day-compact {
						opacity: 1;
					}
					.timeline-num-compact {
						font-size: 14px;
						font-weight: 700;
						line-height: 1;
					}

					/* Combined Filters */
					.combined-filters {
						background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
						border: 1px solid #e2e8f0;
						border-radius: 8px;
						padding: 10px 14px;
						margin-bottom: 12px;
						box-shadow: 0 2px 8px rgba(0,0,0,0.06);
					}
					.filter-section { margin-bottom: 8px; }
					.filter-section:last-child { margin-bottom: 0; }
					.filter-section-label {
						color: #64748b;
						font-size: 10px;
						font-weight: 700;
						margin-bottom: 6px;
						text-transform: uppercase;
						letter-spacing: 0.8px;
						display: flex;
						align-items: center;
						gap: 5px;
					}
					.filter-chips { display: flex; flex-wrap: wrap; gap: 6px; }
					.filter-chip {
						padding: 6px 14px;
						border-radius: 6px;
						font-size: 11px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s;
						border: 2px solid transparent;
						color: #1e293b;
						display: flex;
						align-items: center;
						gap: 6px;
					}
					.filter-chip:hover {
						transform: translateY(-2px);
						box-shadow: 0 4px 12px rgba(0,0,0,0.15);
					}
					.chip-count {
						background: rgba(0, 0, 0, 0.15);
						color: inherit;
						padding: 2px 6px;
						border-radius: 10px;
						font-size: 10px;
						font-weight: 700;
						min-width: 20px;
						text-align: center;
					}
					.filter-chip.active .chip-count { background: rgba(255, 255, 255, 0.3); }
					.filter-chip[data-zone] {
						background: rgba(255, 255, 255, 0.8);
						border: 1px solid #cbd5e1;
						color: #475569;
					}
					.filter-chip[data-zone]:hover {
						background: white;
						border-color: #94a3b8;
					}
					.filter-chip[data-zone].active {
						background: #000;
						color: white;
						border-color: #000;
						box-shadow: 0 2px 8px rgba(0,0,0,0.2);
					}
					.filter-chip[data-category="all"] {
						background: white;
						border: 1px solid #cbd5e1;
						color: #475569;
					}
					.filter-chip[data-category="all"].active {
						background: #000;
						color: white;
						border-color: #000;
					}
					.filter-chip[data-category="Pinnacle"] {
						background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
						color: white !important;
						border-color: #16a34a;
					}
					.filter-chip[data-category="Pinnacle"].active {
						border: 2px dashed white;
						box-shadow: 0 0 0 3px #22c55e, 0 4px 12px rgba(34, 197, 94, 0.4);
					}
					.filter-chip[data-category="Master"] {
						background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%);
						color: white !important;
						border-color: #0d9488;
					}
					.filter-chip[data-category="Master"].active {
						border: 2px dashed white;
						box-shadow: 0 0 0 3px #14b8a6, 0 4px 12px rgba(20, 184, 166, 0.4);
					}
					.filter-chip[data-category="Accelerator"] {
						background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
						color: white !important;
						border-color: #0284c7;
					}
					.filter-chip[data-category="Accelerator"].active {
						border: 2px dashed white;
						box-shadow: 0 0 0 3px #0ea5e9, 0 4px 12px rgba(14, 165, 233, 0.4);
					}
					.filter-chip[data-category="Starter"] {
						background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
						color: white !important;
						border-color: #d97706;
					}
					.filter-chip[data-category="Starter"].active {
						border: 2px dashed white;
						box-shadow: 0 0 0 3px #f59e0b, 0 4px 12px rgba(245, 158, 11, 0.4);
					}
					.filter-chip[data-category="Learner"] {
						background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
						color: white !important;
						border-color: #ea580c;
					}
					.filter-chip[data-category="Learner"].active {
						border: 2px dashed white;
						box-shadow: 0 0 0 3px #f97316, 0 4px 12px rgba(249, 115, 22, 0.4);
					}
					.filter-chip[data-category="Zero Level"] {
						background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
						color: white !important;
						border-color: #dc2626;
					}
					.filter-chip[data-category="Zero Level"].active {
						border: 2px dashed white;
						box-shadow: 0 0 0 3px #ef4444, 0 4px 12px rgba(239, 68, 68, 0.4);
					}
					.clear-filters-btn {
						background: rgba(239, 68, 68, 0.1);
						border: 1px solid rgba(239, 68, 68, 0.3);
						color: #dc2626;
						padding: 5px 14px;
						border-radius: 6px;
						font-size: 11px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s;
						display: inline-flex;
						align-items: center;
						gap: 5px;
					}
					.clear-filters-btn:hover {
						background: rgba(239, 68, 68, 0.2);
						border-color: rgba(239, 68, 68, 0.5);
						color: #b91c1c;
						transform: translateY(-1px);
					}

					/* Active Filter Indicator */
					.active-filter-indicator {
						background: linear-gradient(90deg, #000 0%, #1a1a1a 100%);
						border-left: 3px solid #fff;
						padding: 8px 14px;
						margin-bottom: 12px;
						border-radius: 4px;
						display: none;
						box-shadow: 0 2px 8px rgba(0,0,0,0.2);
					}
					.active-filter-indicator.show { display: block; }
					.filter-indicator-text {
						color: #e0e0e0;
						font-size: 12px;
						font-weight: 600;
						line-height: 1.4;
					}
					.filter-badge {
						display: inline-block;
						background: rgba(255, 255, 255, 0.15);
						color: white;
						padding: 2px 8px;
						border-radius: 10px;
						font-size: 10px;
						font-weight: 700;
						margin: 0 3px;
					}

					/* Table Styles */
					.sahayog-content { position: relative; }
					.view-container { display: none; }
					.view-container.active { display: block; }

					.table-header-controls {
						display: flex;
						justify-content: space-between;
						align-items: center;
						padding: 12px 16px;
						background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
						border: 1px solid #e2e8f0;
						border-bottom: none;
						border-radius: 6px 6px 0 0;
						gap: 16px;
						flex-wrap: wrap;
					}
					.table-header-left, .table-header-right {
						display: flex;
						align-items: center;
						gap: 12px;
						flex-wrap: wrap;
					}
					.table-header-title {
						font-size: 13px;
						font-weight: 700;
						color: #1e293b;
						text-transform: uppercase;
						letter-spacing: 0.5px;
					}

					.grouping-toggle {
						display: inline-flex;
						gap: 0;
						background: white;
						border-radius: 5px;
						padding: 2px;
						border: 1px solid #cbd5e1;
					}
					.grouping-btn {
						padding: 5px 12px;
						border: none;
						background: transparent;
						color: #64748b;
						font-size: 11px;
						font-weight: 600;
						cursor: pointer;
						border-radius: 4px;
						transition: all 0.2s;
						display: flex;
						align-items: center;
						gap: 5px;
					}
					.grouping-btn:hover {
						background: #f1f5f9;
						color: #334155;
					}
					.grouping-btn.active {
						background: #000;
						color: white;
						box-shadow: 0 1px 3px rgba(0,0,0,0.2);
					}

					/* Chart Visualize Button */
					.chart-visualize-wrapper { position: relative; }
					.chart-visualize-btn {
						background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
						color: white;
						border: none;
						padding: 5px 12px;
						border-radius: 5px;
						font-size: 11px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s;
						display: flex;
						align-items: center;
						gap: 6px;
					}
					.chart-visualize-btn:hover {
						background: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%);
						transform: translateY(-1px);
						box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
					}
					.chart-dropdown {
						position: absolute;
						top: 100%;
						right: 0;
						margin-top: 5px;
						background: white;
						border: 1px solid #cbd5e1;
						border-radius: 6px;
						box-shadow: 0 4px 16px rgba(0,0,0,0.15);
						min-width: 180px;
						z-index: 1000;
						display: none;
					}
					.chart-dropdown.show { display: block; }
					.chart-dropdown-item {
						padding: 10px 14px;
						cursor: pointer;
						transition: all 0.2s;
						display: flex;
						align-items: center;
						gap: 10px;
						font-size: 12px;
						color: #475569;
						border-bottom: 1px solid #f1f5f9;
					}
					.chart-dropdown-item:last-child { border-bottom: none; }
					.chart-dropdown-item:hover {
						background: #f8fafc;
						color: #000;
					}
					.chart-dropdown-item i {
						font-size: 14px;
						width: 20px;
						text-align: center;
					}
					.chart-dropdown-item.bar-chart i { color: #6366f1; }
					.chart-dropdown-item.bubble-chart i { color: #ec4899; }

					.toggle-all-btn {
						background: #000;
						color: white;
						border: none;
						padding: 5px 12px;
						border-radius: 5px;
						font-size: 11px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s;
						display: flex;
						align-items: center;
						gap: 6px;
					}
					.toggle-all-btn:hover {
						background: #2d2d2d;
						transform: translateY(-1px);
					}

					/* Chart Modal */
					.chart-modal {
						display: none;
						position: fixed;
						top: 0;
						left: 0;
						right: 0;
						bottom: 0;
						background: rgba(0, 0, 0, 0.7);
						z-index: 2000;
						align-items: center;
						justify-content: center;
						padding: 20px;
					}
					.chart-modal.show { display: flex; }
					.chart-modal-content {
						background: white;
						border-radius: 8px;
						width: 90%;
						max-width: 1200px;
						max-height: 90vh;
						overflow: auto;
						box-shadow: 0 10px 40px rgba(0,0,0,0.3);
					}
					.chart-modal-header {
						background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
						color: white;
						padding: 16px 20px;
						display: flex;
						justify-content: space-between;
						align-items: center;
						border-radius: 8px 8px 0 0;
					}
					.chart-modal-title {
						font-size: 16px;
						font-weight: 700;
						display: flex;
						align-items: center;
						gap: 10px;
					}
					.chart-modal-close {
						background: rgba(255, 255, 255, 0.2);
						border: none;
						color: white;
						padding: 6px 12px;
						border-radius: 4px;
						font-size: 12px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s;
					}
					.chart-modal-close:hover {
						background: rgba(255, 255, 255, 0.3);
					}
					.chart-modal-body { padding: 20px; }
					#chart-container { width: 100%; height: 500px; }

					.table-container-wrapper {
						position: relative;
						max-height: 600px;
						overflow-y: auto;
						background: var(--card-bg);
						border: 1px solid var(--border-color);
						border-radius: 0 0 6px 6px;
					}
					.sahayog-table {
						width: 100%;
						border-collapse: collapse;
						font-size: 13px;
					}
					.sahayog-table th,
					.sahayog-table td {
						padding: 12px 14px;
						text-align: right;
						border-bottom: 1px solid var(--table-border-color);
					}
					.sahayog-table .row-label {
						text-align: left;
						font-weight: 500;
					}
					.sahayog-table thead th {
						background: #000;
						color: white;
						font-size: 11px;
						font-weight: 700;
						text-transform: uppercase;
						letter-spacing: 0.5px;
						position: sticky;
						top: 0;
						z-index: 10;
						border: none;
					}
					.group-row {
						background: var(--bg-light-gray);
						font-weight: 600;
						cursor: pointer;
						transition: background 0.2s;
					}
					.group-row:hover { background: var(--bg-color); }
					.collapse-icon {
						display: inline-block;
						margin-right: 8px;
						transition: transform 0.2s;
						color: #000;
						font-size: 10px;
					}
					.group-row.collapsed .collapse-icon { transform: rotate(-90deg); }
					.child-row { transition: all 0.2s; }
					.child-row:hover {
						transform: scale(1.002);
						box-shadow: 0 2px 8px rgba(0,0,0,0.1);
					}
					.child-row td.row-label {
						padding-left: 36px;
						font-weight: 600;
					}
					.child-row.hidden { display: none; }
					.child-row.filtered-out { display: none !important; }

					/* Category Colors */
					.cat-Pinnacle {
						background: linear-gradient(90deg, rgba(34, 197, 94, 0.15) 0%, rgba(34, 197, 94, 0.05) 100%);
						border-left: 5px solid #22c55e;
					}
					.cat-Pinnacle:hover {
						background: linear-gradient(90deg, rgba(34, 197, 94, 0.25) 0%, rgba(34, 197, 94, 0.10) 100%);
					}
					.cat-master {
						background: linear-gradient(90deg, rgba(20, 184, 166, 0.15) 0%, rgba(20, 184, 166, 0.05) 100%);
						border-left: 5px solid #14b8a6;
					}
					.cat-master:hover {
						background: linear-gradient(90deg, rgba(20, 184, 166, 0.25) 0%, rgba(20, 184, 166, 0.10) 100%);
					}
					.cat-accelerator {
						background: linear-gradient(90deg, rgba(14, 165, 233, 0.15) 0%, rgba(14, 165, 233, 0.05) 100%);
						border-left: 5px solid #0ea5e9;
					}
					.cat-accelerator:hover {
						background: linear-gradient(90deg, rgba(14, 165, 233, 0.25) 0%, rgba(14, 165, 233, 0.10) 100%);
					}
					.cat-starter {
						background: linear-gradient(90deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%);
						border-left: 5px solid #f59e0b;
					}
					.cat-starter:hover {
						background: linear-gradient(90deg, rgba(245, 158, 11, 0.25) 0%, rgba(245, 158, 11, 0.10) 100%);
					}
					.cat-learner {
						background: linear-gradient(90deg, rgba(249, 115, 22, 0.15) 0%, rgba(249, 115, 22, 0.05) 100%);
						border-left: 5px solid #f97316;
					}
					.cat-learner:hover {
						background: linear-gradient(90deg, rgba(249, 115, 22, 0.25) 0%, rgba(249, 115, 22, 0.10) 100%);
					}
					.cat-zero {
						background: linear-gradient(90deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.05) 100%);
						border-left: 5px solid #ef4444;
					}
					.cat-zero:hover {
						background: linear-gradient(90deg, rgba(239, 68, 68, 0.25) 0%, rgba(239, 68, 68, 0.10) 100%);
					}

					.tgt-ach-cell { font-size: 12px; line-height: 1.5; }
					.tgt-line { color: var(--text-muted); font-weight: 500; }
					.ach-line { color: #000; font-weight: 700; }
					.na-text {
						color: #94a3b8;
						font-style: italic;
						font-size: 11px;
						font-weight: 600;
						letter-spacing: 0.5px;
					}

					.grand-total-row {
						background: linear-gradient(135deg, #000 0%, #1a1a1a 100%) !important;
						font-weight: 700;
						border-top: 3px solid #fff !important;
						box-shadow: 0 -4px 12px rgba(0,0,0,0.3);
					}
					.grand-total-row td {
						color: #ffffff !important;
						border-bottom: none !important;
						padding: 14px !important;
					}
					.grand-total-row .tgt-line,
					.grand-total-row .ach-line {
						color: #ffffff !important;
					}

					/* Drill-down Segment Styles */
					.perf-top-row { background-color: #e9f8db; } /* Light Green */
					.perf-next-row { background-color: #e0f2fe; } /* Light Blue */
					.perf-mid-row { background-color: #fdeace; } /* Light Orange */
					.perf-bottom-row { background-color: #fadadd; } /* Light Red */

					.perf-badge {
						display: inline-block;
						padding: 3px 10px;
						border-radius: 12px;
						font-size: 11px;
						font-weight: 600;
					}
					.perf-badge.green { background-color: #b7eb8f; color: #389e0d; border: 1px solid #95de64; }
					.perf-badge.blue { background-color: #bae7ff; color: #096dd9; border: 1px solid #91d5ff; }
					.perf-badge.orange { background-color: #ffe7ba; color: #d46b08; border: 1px solid #ffd591; }
					.perf-badge.red { background-color: #ffccc7; color: #cf1322; border: 1px solid #ffa39e; }
					.perf-badge.grey { background-color: #f5f5f5; color: #8c8c8c; border: 1px solid #d9d9d9;}

					.drill-down-filters {
						padding: 16px;
						background-color: #f8fafc;
						border: 1px solid #e2e8f0;
						border-radius: 8px;
						margin-bottom: 16px;
						display: flex;
						gap: 20px;
						align-items: center;
					}
					.drill-down-filters .filter-group {
						display: flex;
						flex-direction: column;
						gap: 4px;
					}
					.drill-down-filters label {
						font-size: 11px;
						font-weight: 700;
						color: #64748b;
						text-transform: uppercase;
					}
					.drill-down-filters input, .drill-down-filters select {
						min-width: 250px;
						padding: 8px 12px;
						border-radius: 6px;
						border: 1px solid #cbd5e1;
						background: #fff;
						font-size: 13px;
					}
					.drill-down-filters .filter-group button {
						padding: 8px 16px;
						border-radius: 6px;
						border: none;
						background: #dc2626;
						color: white;
						font-weight: 600;
						cursor: pointer;
						align-self: flex-end;
					}

					.drill-down-view {
						display: none;
						position: fixed;
						top: 0;
						left: 0;
						right: 0;
						bottom: 0;
						background: var(--bg-color);
						z-index: 1050;
						overflow: auto;
					}
					.drill-down-view.active { display: block; }
					.drill-down-header {
						background: #000;
						color: white;
						padding: 14px 20px;
						display: flex;
						justify-content: space-between;
						align-items: center;
						position: sticky;
						top: 0;
						z-index: 100;
						box-shadow: 0 2px 10px rgba(0,0,0,0.3);
						gap: 20px;
					}
					.drill-target-types {
						display: flex;
						gap: 8px;
						align-items: center;
					}
					.drill-target-type-btn {
						padding: 7px 14px;
						border: 1px solid rgba(255, 255, 255, 0.2);
						background: transparent;
						color: rgba(255, 255, 255, 0.8);
						font-size: 12px;
						font-weight: 600;
						border-radius: 4px;
						cursor: pointer;
						transition: all 0.2s;
					}
					.drill-target-type-btn:hover {
						background: rgba(255, 255, 255, 0.1);
						border-color: rgba(255, 255, 255, 0.4);
						color: white;
					}
					.drill-target-type-btn.active {
						background: white;
						color: #000;
						border-color: white;
						box-shadow: 0 2px 6px rgba(255, 255, 255, 0.2);
					}
					.drill-down-title {
						font-size: 15px;
						font-weight: 600;
						display: flex;
						align-items: center;
						gap: 10px;
					}
					.drill-close-btn {
						background: rgba(255, 255, 255, 0.15);
						border: none;
						color: white;
						padding: 7px 18px;
						border-radius: 4px;
						font-size: 13px;
						font-weight: 600;
						cursor: pointer;
						transition: all 0.2s;
						display: flex;
						align-items: center;
						gap: 6px;
					}
					.drill-close-btn:hover {
						background: rgba(255, 255, 255, 0.25);
					}
					.drill-down-body {
						padding: 20px;
						max-width: 1600px;
						margin: 0 auto;
					}

					/* Performance Segments */
					.segment-header-row {
						font-weight: 700;
						cursor: pointer;
						transition: all 0.2s;
						border-top: 2px solid #cbd5e1 !important;
					}
					.segment-header-row:hover { opacity: 0.9; }
					.segment-header-row td {
						padding: 14px 16px !important;
						font-size: 13px;
						text-transform: uppercase;
						letter-spacing: 0.5px;
						color: white !important;
					}
					.segment-header-row .collapse-icon {
						display: inline-block;
						margin-right: 10px;
						transition: all 0.2s;
						font-size: 14px;
						width: 15px;
						text-align: center;
						color: white;
					}

					.segment-top {
						background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
						border-left: 5px solid #15803d !important;
						box-shadow: 0 2px 8px rgba(34, 197, 94, 0.3);
					}
					.segment-top:hover {
						background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
					}

					.segment-next {
						background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
						border-left: 5px solid #0369a1 !important;
						box-shadow: 0 2px 8px rgba(14, 165, 233, 0.3);
					}
					.segment-next:hover {
						background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
					}

					.segment-mid {
						background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
						border-left: 5px solid #b45309 !important;
						box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);
					}
					.segment-mid:hover {
						background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
					}

					.segment-bottom {
						background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
						border-left: 5px solid #b91c1c !important;
						box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
					}
					.segment-bottom:hover {
						background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
					}

					.segment-child-1,
					.segment-child-2,
					.segment-child-3,
					.segment-child-4 {
						transition: all 0.2s;
					}
					.segment-child-1:hover,
					.segment-child-2:hover,
					.segment-child-3:hover,
					.segment-child-4:hover {
						transform: scale(1.001);
						box-shadow: 0 2px 8px rgba(0,0,0,0.1);
					}

					.segment-child-1 {
						background: linear-gradient(90deg, rgba(34, 197, 94, 0.05) 0%, transparent 100%);
					}
					.segment-child-2 {
						background: linear-gradient(90deg, rgba(14, 165, 233, 0.05) 0%, transparent 100%);
					}
					.segment-child-3 {
						background: linear-gradient(90deg, rgba(245, 158, 11, 0.05) 0%, transparent 100%);
					}
					.segment-child-4 {
						background: linear-gradient(90deg, rgba(239, 68, 68, 0.05) 0%, transparent 100%);
					}

					/* Comparison Toggle */
					.comparison-toggle {
						display: flex;
						gap: 8px;
						align-items: center;
						margin-bottom: 8px;
					}
					.comparison-btns {
						display: flex;
						gap: 4px;
					}
					.comparison-btn {
						padding: 5px 12px;
						border: 1px solid #cbd5e1;
						background: white;
						color: #64748b;
						font-size: 11px;
						font-weight: 600;
						border-radius: 5px;
						cursor: pointer;
						transition: all 0.2s;
						display: flex;
						align-items: center;
						gap: 4px;
					}
					.comparison-btn:hover {
						background: #f8fafc;
						border-color: #94a3b8;
						color: #334155;
					}
					.comparison-btn.active {
						background: #1e293b;
						color: white;
						border-color: #1e293b;
						box-shadow: 0 2px 6px rgba(30, 41, 59, 0.3);
					}

					/* Comparison Indicators */
					.cmp-indicator {
						display: inline-block;
						margin-left: 6px;
						padding: 1px 6px;
						border-radius: 3px;
						font-size: 10px;
						font-weight: 700;
						white-space: nowrap;
						color: white !important;
					}
					.cmp-indicator.green {
						background: #22c55e;
						color: white !important;
					}
					.cmp-indicator.red {
						background: #ef4444;
						color: white !important;
					}
					.cmp-indicator.grey {
						background: rgba(148, 163, 184, 0.4);
						color: white !important;
					}
					.cmp-indicator-clickable:hover {
						opacity: 0.8;
						box-shadow: 0 0 8px rgba(0, 0, 0, 0.2);
						transform: scale(1.05);
						transition: all 0.2s ease;
					}

					/* Fixed Header Styles */
					#sahayog-fixed-header {
						position: sticky;
						top: 0;
						z-index: 110;
						background: linear-gradient(90deg, #000, #111);
						color: white;
						padding: 10px 16px;
						display: flex;
						justify-content: space-between;
						align-items: center;
						border-bottom: 1px solid rgba(255,255,255,0.1);
						box-shadow: 0 2px 8px rgba(0,0,0,0.3);
					}
					#sahayog-fixed-header .target-type-btn {
						padding: 6px 12px;
						border-radius: 6px;
						border: 1px solid rgba(255,255,255,0.2);
						background: rgba(255,255,255,0.05);
						color: white;
						font-weight: 700;
						font-size: 12px;
						cursor: pointer;
						transition: all 0.2s ease;
					}
					#sahayog-fixed-header .target-type-btn:hover {
						background: rgba(255,255,255,0.1);
						border-color: rgba(255,255,255,0.3);
						transform: translateY(-1px);
					}
					#sahayog-fixed-header .target-type-btn.active {
						background: white;
						color: #000;
						border-color: white;
						box-shadow: 0 2px 8px rgba(255,255,255,0.3);
					}

					@media (max-width: 768px) {
						.table-header-controls { flex-direction: column; }
						.comparison-btns { flex-wrap: wrap; }
					}

/* Branch Profile Modal */
.branch-profile-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 2100;
    align-items: center;
    justify-content: center;
    padding: 0;
}

.branch-profile-modal.show {
    display: flex;
}

.branch-profile-content {
    background: white;
    border-radius: 0;
    width: 100%;
    max-width: 100%;
    max-height: 100vh;
    overflow: auto;
    box-shadow: none;
}

.branch-profile-header {
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    color: white;
    padding: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 8px 8px 0 0;
}

.branch-profile-close {
    background: rgba(255, 255, 255, 0.2);
    border: none;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
}

.branch-profile-body {
    padding: 24px;
}

.profile-summary-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-bottom: 24px;
}

.profile-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 16px;
    text-align: center;
}

.profile-card-label {
    font-size: 11px;
    color: #64748b;
    font-weight: 600;
    margin-bottom: 8px;
    text-transform: uppercase;
}

.profile-card-value {
    font-size: 20px;
    font-weight: 700;
    color: #1e293b;
}

.profile-section {
    margin-bottom: 24px;
}

.profile-section h3 {
    font-size: 14px;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.profile-table {
    width: 100%;
    border-collapse: collapse;
}

.profile-table th,
.profile-table td {
    padding: 12px;
    text-align: right;
    border-bottom: 1px solid #e2e8f0;
}

.profile-table th:first-child,
.profile-table td:first-child {
    text-align: left;
}

.profile-table th {
    background: #f8fafc;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
}

.performance-summary {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.perf-item {
    background: #f8fafc;
    padding: 16px;
    border-radius: 6px;
}

.perf-label {
    font-size: 12px;
    font-weight: 600;
    color: #64748b;
    margin-bottom: 8px;
}

.perf-bar {
    height: 24px;
    background: #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 8px;
}

.perf-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #22c55e 0%, #16a34a 100%);
    transition: width 0.3s ease;
}

.perf-stats {
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
}

.category-badge {
    display: inline-block;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
}

.branch-name-cell:hover {
    background: #f1f5f9;
    cursor: pointer;
}
				</style>
			`;
		$(styles).appendTo("head");
	}

	createContentArea() {
		const contentHtml = `
				<div class="sahayog-content">
					<div id="dashboard-view" class="view-container active"></div>
					<div id="branch-targets-view" class="view-container"></div>
				</div>
			`;
		$(contentHtml).appendTo(this.page.main);

		this.page.set_secondary_action("Branch Targets", () => this.loadView("branch-targets"));
	}

	// Create a fixed header component visible on main and drill screens
	createFixedHeader() {
		console.log("Creating fixed header...", this.page.main);
		const headerHtml = `
			<div id="sahayog-fixed-header" style="position:sticky; top:0; z-index:110; background:linear-gradient(90deg,#000,#111); color:white; padding:10px 16px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1);">
				<div style="font-weight:700; font-size:14px;">DRISHTI — Target vs Achievement</div>
				<div style="display:flex; gap:8px; align-items:center;">
					<div style="font-size:12px; opacity:0.9; margin-right:6px;">View:</div>
					<button class="target-type-btn ${
						this.targetType === "Yearly" ? "active" : ""
					}" data-type="Yearly">Yearly</button>
					<button class="target-type-btn ${
						this.targetType === "YTD" ? "active" : ""
					}" data-type="YTD">YTD</button>
					<button class="target-type-btn ${
						this.targetType === "Monthly" ? "active" : ""
					}" data-type="Monthly">Monthly</button>
				</div>
			</div>
		`;
		const $header = $(headerHtml);
		$header.prependTo(this.page.main);
		console.log("Fixed header created and appended", $("#sahayog-fixed-header"));

		// Attach click handlers
		$(document).on("click", "#sahayog-fixed-header .target-type-btn", (e) => {
			e.preventDefault();
			const btn = $(e.currentTarget);
			const type = btn.data("type");
			console.log("Target type button clicked:", type);
			this.targetType = type;
			$("#sahayog-fixed-header .target-type-btn").removeClass("active");
			btn.addClass("active");
			this.saveState();
			// reload views with new target type
			if ($("#drill-down-view").hasClass("active")) {
				// In drill-down mode: reload drill-down data
				console.log("Reloading drill-down data with target_type:", type);
				this.openDrillDown(this.currentZone, this.currentCategory);
			} else if (this.currentView === "branch-targets") {
				console.log("Reloading branch targets with target_type:", type);
				this.loadBranchTargets();
			} else {
				// In dashboard mode
				console.log("Reloading dashboard data with target_type:", type);
				this.loadDashboardData();
			}
		});
	}

	createChartModal() {
		const modalHtml = `
				<div class="chart-modal" id="chart-modal">
					<div class="chart-modal-content">
						<div class="chart-modal-header">
							<div class="chart-modal-title"><i class="fa fa-chart-bar"></i> <span id="chart-modal-title">Chart</span></div>
							<button class="chart-modal-close" id="chart-modal-close">Close</button>
						</div>
						<div class="chart-modal-body">
							<div id="chart-container"></div>
						</div>
					</div>
				</div>
			`;

		$("body").append(modalHtml);

		$("#chart-modal-close").on("click", () => this.closeChartModal());
		$(window).on("resize.sahayog_chart", () => {
			if (this.chartInstance && this.chartInstance.resize) {
				this.chartInstance.resize();
			}
		});
	}
	showComparisonDetailPopup(zone, category) {
		// ============================================================
		// VALIDATION & DEBUG
		// ============================================================
		console.log('🔍 showComparisonDetailPopup called with:', {
			zone: zone,
			category: category,
			zoneType: typeof zone,
			categoryType: typeof category
		});

		// Guard: if a popup is already open, don't open another one
		if (this.isComparisonPopupOpen) {
			console.warn('⚠️ Popup already open, skipping...');
			return;
		}

		// Validate zone
		if (!zone || zone === "Unknown" || zone === "undefined" || zone === null || zone === "ALL") {
			console.error('❌ Invalid zone:', zone);
			frappe.msgprint({
				title: "Zone Required",
				message: "Cannot show comparison without a specific zone. Please click on a zone-specific row.",
				indicator: "orange",
			});
			return;
		}

		// Validate category
		if (!category || category === "Unknown" || category === "undefined" || category === null || category === "ALL") {
			console.error('❌ Invalid category:', category);
			frappe.msgprint({
				title: "Category Required",
				message: "Cannot show comparison without a specific category.",
				indicator: "orange",
			});
			return;
		}

		this.isComparisonPopupOpen = true;
		console.log('✅ Validation passed, calling API...');

		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_branch_comparison_detail",
			args: {
				current_date: this.selectedDate,
				mode: this.comparisonMode,
				zone: zone,
				category: category,
				filters: this.getFiltersJSON(),
				target_type: this.targetType,
			},
			callback: (r) => {
				if (!r.message) {
					this.isComparisonPopupOpen = false;
					frappe.msgprint({
						title: "Error",
						message: "Could not load comparison details.",
						indicator: "red",
					});
					return;
				}

				const data = r.message;
				console.log("=".repeat(80));
				console.log("📥 API Response:", data);
				console.log("📊 Net Change:", data.net_change);
				console.log("📦 Branch Count:", data.count);
				console.log("🏢 Branches:", data.branches);
				console.log("=".repeat(80));

				// ============================================================
				// BUILD TABLE from new response structure
				// ============================================================
				let tableRows = "";
				let title = "No Changes";
				let titleColor = "#64748b";

				if (data.branches && data.branches.length > 0) {
					// Set title based on change type
					if (data.net_change > 0) {
						title = `+${data.net_change} Branch(es) Added to ${category}`;
						titleColor = "#16a34a";
					} else if (data.net_change < 0) {
						title = `${data.net_change} Branch(es) Removed from ${category}`;
						titleColor = "#dc2626";
					} else {
						title = `${data.count} Branch Movement(s)`;
						titleColor = "#6366f1";
					}

					tableRows = data.branches
						.map((b, index) => {
							// Determine row color based on change type
							let rowBg = "#ffffff";
							let changeIcon = "↔️";
							let changeColor = "#64748b";

							if (b.change_type === "added") {
								rowBg = "#f0fdf4";
								changeIcon = "✅";
								changeColor = "#16a34a";
							} else if (b.change_type === "removed") {
								rowBg = "#fef2f2";
								changeIcon = "❌";
								changeColor = "#dc2626";
							}

							return `
                            <tr style="background: ${rowBg}; border-bottom: 1px solid #f1f5f9;">
                                <td style="padding: 10px 12px; font-size: 13px; font-weight: 600; color: #64748b; text-align: center;">${
									index + 1
								}</td>
                                <td style="padding: 10px 12px; font-size: 13px;">${
									b.sol_id || "NA"
								}</td>
                                <td style="padding: 10px 12px; font-size: 13px; font-weight: 600;">${
									b.branch || "Unknown"
								}</td>
                                <td style="padding: 10px 12px; font-size: 13px;">${
									b.zone || "Unknown"
								}</td>
                                <td style="padding: 10px 12px; font-size: 13px; color: #64748b;">${
									b.previous_category || "N/A"
								}</td>
                                <td style="padding: 10px 12px; font-size: 13px; font-weight: 700; color: #1f2937;">${
									b.current_category || "N/A"
								}</td>
                                <td style="padding: 10px 12px; font-size: 13px; font-weight: 700; color: ${changeColor};">
                                    ${changeIcon} ${
								b.change_type === "added"
									? "Added"
									: b.change_type === "removed"
									? "Removed"
									: "Moved"
							}
                                </td>
                            </tr>
                        `;
						})
						.join("");
				} else {
					tableRows = `
                    <tr>
                        <td colspan="7" style="padding: 24px 12px; text-align: center; color: #9ca3af; font-size: 13px;">
                            No branch changes to display
                        </td>
                    </tr>
                `;
				}

				console.log("✅ Table Rows Generated:", tableRows ? "YES" : "NO");

				// ============================================================
				// POPUP HTML
				// ============================================================
				const htmlContent = `
                <div style="padding: 12px 4px;">
                    <!-- Header Card -->
                    <div style="background: linear-gradient(135deg, ${titleColor} 0%, ${titleColor}dd 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; text-align: center;">
                        <div style="font-size: 28px; font-weight: 700; margin-bottom: 8px;">
                            ${data.net_change > 0 ? "+" : ""}${data.net_change}
                        </div>
                        <div style="font-size: 16px; font-weight: 600; opacity: 0.95;">
                            ${title}
                        </div>
                        <div style="font-size: 13px; opacity: 0.8; margin-top: 4px;">
                            ${zone} • Comparing with previous date
                        </div>
                    </div>

                    <!-- Stats Row -->
                    <div style="display: flex; gap: 12px; margin-bottom: 20px; justify-content: center;">
                        <div style="flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">Total Showing</div>
                            <div style="font-size: 20px; font-weight: 700; color: #1f2937;">${
								data.count
							}</div>
                        </div>
                        <div style="flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; text-align: center;">
                            <div style="font-size: 11px; color: #64748b; margin-bottom: 4px;">Net Change</div>
                            <div style="font-size: 20px; font-weight: 700; color: ${
								data.net_change > 0
									? "#16a34a"
									: data.net_change < 0
									? "#dc2626"
									: "#64748b"
							};">
                                ${data.net_change > 0 ? "+" : ""}${data.net_change}
                            </div>
                        </div>
                    </div>

                    <!-- Table -->
                    <div style="max-height: 450px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead style="position: sticky; top: 0; background: #f9fafb; z-index: 10;">
                                <tr style="border-bottom: 2px solid #e5e7eb;">
                                    <th style="padding: 12px; text-align: center; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase; width: 50px;">#</th>
                                    <th style="padding: 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">SOL ID</th>
                                    <th style="padding: 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Branch Name</th>
                                    <th style="padding: 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Zone</th>
                                    <th style="padding: 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Previous</th>
                                    <th style="padding: 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Current</th>
                                    <th style="padding: 12px; text-align: left; font-size: 11px; font-weight: 700; color: #6b7280; text-transform: uppercase;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tableRows}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

				// ============================================================
				// SHOW DIALOG
				// ============================================================
				const d = new frappe.ui.Dialog({
					title: `Branch Comparison: ${category}`,
					size: "large",
					fields: [
						{
							fieldtype: "HTML",
							options: htmlContent,
						},
					],
					primary_action_label: "Close",
					primary_action: () => d.hide(),
					onhide: () => {
						this.isComparisonPopupOpen = false;
					},
				});

				d.show();
			},
			error: (err) => {
				console.error("❌ API Error:", err);
				this.isComparisonPopupOpen = false;
				frappe.msgprint({
					title: "Error",
					message: "Failed to fetch comparison details",
					indicator: "red",
				});
			},
		});
	}

	openChartModal(type) {
		$("#chart-modal").addClass("show");
		$("#chart-modal-title").text(
			type === "bar" ? "Bar Chart - Performance Overview" : "Bubble Chart - Zone vs Category"
		);

		const render = () => {
			if (!window.echarts) {
				setTimeout(render, 150);
				return;
			}
			this.renderChart(type);
		};
		render();
	}

	closeChartModal() {
		$("#chart-modal").removeClass("show");
		if (this.chartInstance && this.chartInstance.dispose) {
			this.chartInstance.dispose();
			this.chartInstance = null;
		}
	}

	renderChart(type) {
		const container = document.getElementById("chart-container");
		if (!container) return;
		container.innerHTML = "";
		const chart = window.echarts.init(container);
		this.chartInstance = chart;

		if (!this.rawData) {
			chart.setOption({ title: { text: "No data available" } });
			return;
		}

		if (type === "bar") {
			this.renderBarChart(chart);
		} else {
			this.renderBubbleChart(chart);
		}
	}

	renderBarChart(chart) {
		const groupBy = this.groupBy || "zone";
		const showAllZones = this.filters.zones.size === 0;
		const showAllCategories = this.filters.categories.size === 0;

		const xLabels = [];
		const tgtSeries = [];
		const achSeries = [];

		if (groupBy === "zone") {
			this.rawData.zones.forEach((z) => {
				if (
					showAllZones ||
					this.filters.zones.has(z.zone) ||
					this.filters.zones.size === 0
				) {
					xLabels.push(z.zone);
					tgtSeries.push(z.total.tgt || 0);
					achSeries.push(z.total.ach || 0);
				}
			});
		} else {
			const categories = this.transformToCategoryGrouping(this.rawData);
			categories.forEach((c) => {
				if (
					showAllCategories ||
					this.filters.categories.has(c.category) ||
					this.filters.categories.size === 0
				) {
					xLabels.push(c.category);
					tgtSeries.push(c.total.tgt || 0);
					achSeries.push(c.total.ach || 0);
				}
			});
		}

		const option = {
			title: { text: "Target vs Achievement" },
			tooltip: { trigger: "axis" },
			legend: { data: ["Target", "Achievement"] },
			toolbox: { feature: { saveAsImage: {} } },
			xAxis: { type: "category", data: xLabels },
			yAxis: { type: "value" },
			series: [
				{
					name: "Target",
					type: "bar",
					data: tgtSeries,
					itemStyle: { color: "#60a5fa" },
					label: {
						show: true,
						position: "top",
						formatter: (params) => this.formatNumber(params.value),
					},
				},
				{
					name: "Achievement",
					type: "bar",
					data: achSeries,
					itemStyle: { color: "#16a34a" },
					label: {
						show: true,
						position: "top",
						formatter: (params) => this.formatNumber(params.value),
					},
				},
			],
		};

		chart.setOption(option);
	}

	renderBubbleChart(chart) {
		const zones = this.availableZones;
		const categoryOrder = this.availableCategories;
		const dataPoints = [];

		this.rawData.zones.forEach((z) => {
			if (this.filters.zones.size === 0 || this.filters.zones.has(z.zone)) {
				z.categories.forEach((c) => {
					if (
						this.filters.categories.size === 0 ||
						this.filters.categories.has(c.category)
					) {
						const size = c.total.ach || 0;
						const zi = zones.indexOf(z.zone);
						const yi = categoryOrder.indexOf(c.category);
						if (zi >= 0 && yi >= 0 && size > 0) {
							dataPoints.push([zi, yi, Math.round(size / 1000)]);
						}
					}
				});
			}
		});

		const option = {
			title: { text: "Zone vs Category - Achievement" },
			xAxis: {
				type: "category",
				data: zones,
				name: "Zone",
				axisLabel: { rotate: 45 },
			},
			yAxis: {
				type: "category",
				data: categoryOrder,
				name: "Category",
			},
			series: [
				{
					type: "scatter",
					symbolSize: function (data) {
						return Math.max(10, Math.sqrt(data[2]) * 3);
					},
					data: dataPoints,
					itemStyle: {
						color: "#ec4899",
						opacity: 0.7,
					},
				},
			],
			tooltip: {
				formatter: function (params) {
					const zi = params.value[0];
					const yi = params.value[1];
					const size = params.value[2];
					return `
							${zones[zi]} / ${categoryOrder[yi]}<br/>
							Achievement: ${(size * 1000).toLocaleString()}
						`;
				},
			},
		};

		chart.setOption(option);
	}

	createDrillDownView() {
		const drillHtml = `
				<div class="drill-down-view" id="drill-down-view">
					<div class="drill-down-header">
						<div class="drill-down-title">
							<i class="fa fa-layer-group"></i>
							<span id="drill-title"></span>
						</div>
						<div class="drill-target-types">
							<button class="drill-target-type-btn" data-type="Monthly">Monthly</button>
							<button class="drill-target-type-btn" data-type="Yearly">Yearly</button>
							<button class="drill-target-type-btn" data-type="YTD">YTD</button>
						</div>
						<button class="drill-close-btn" id="drill-close">
							<i class="fa fa-times"></i> Close
						</button>
					</div>
					<div class="drill-down-body">
						<div id="drill-segments-container"></div>
					</div>
				</div>
			`;

		$("body").append(drillHtml);

		$("#drill-close").on("click", () => this.closeDrillDown());

		// Handle drill-down target type buttons
		$(".drill-target-type-btn")
			.off("click")
			.on("click", (e) => {
				const type = $(e.currentTarget).data("type");
				console.log("Drill-down target type button clicked:", type);
				this.targetType = type;
				this.updateDrillDownHeaderButtons();
				this.openDrillDown(this.currentZone, this.currentCategory);
			});
	}

	loadView(view) {
		this.currentView = view;
		$(".view-container").removeClass("active");
		$(`#${view}-view`).addClass("active");

		if (view === "dashboard") {
			this.page.set_title("DRISHTI");
			this.loadDashboardData();
		} else if (view === "branch-targets") {
			this.page.set_title("Branch Targets");
			this.loadBranchTargets();
		}
	}

	loadDashboardData() {
		if (!this.selectedDate) return;

		// Refresh comparison data in parallel
		this.loadComparisonData();

		const container = $("#dashboard-view");
		container.html(`
				<div class="table-header-controls">
					<div class="table-header-left">
						<div class="table-header-title">Performance Overview</div>
						<div class="comparison-toggle" style="display:flex; gap:8px; align-items:center; margin-left:20px;">
							<div style="font-size:11px; font-weight:700; color:#64748b;">Compare:</div>
							<div class="comparison-btns">
								<button class="comparison-btn ${
									this.comparisonMode === "daily" ? "active" : ""
								}" data-mode="daily">Daily</button>
								<button class="comparison-btn ${
									this.comparisonMode === "weekly" ? "active" : ""
								}" data-mode="weekly">Weekly</button>
								<button class="comparison-btn ${
									this.comparisonMode === "monthly" ? "active" : ""
								}" data-mode="monthly">Monthly</button>
							</div>
						</div>
					</div>
					<div class="table-header-right">
						<div class="grouping-toggle">
							<button class="grouping-btn ${this.groupBy === "zone" ? "active" : ""}" data-group="zone">
								<i class="fa fa-map-marker-alt"></i> Zone
							</button>
							<button class="grouping-btn ${this.groupBy === "category" ? "active" : ""}" data-group="category">
								<i class="fa fa-layer-group"></i> Category
							</button>
						</div>
						<div class="chart-visualize-wrapper">
							<button class="chart-visualize-btn" id="chart-visualize-btn">📊 Visualize ▼</button>
							<div class="chart-dropdown" id="chart-dropdown">
								<div class="chart-dropdown-item bar-chart" data-chart="bar"><i>▦</i> Bar Chart</div>
								<div class="chart-dropdown-item bubble-chart" data-chart="bubble"><i>●</i> Bubble Chart</div>
							</div>
						</div>
						<button class="toggle-all-btn" id="toggle-all-rows">
							<i class="fa fa-expand-alt"></i> <span>Expand All</span>
						</button>
					</div>
				</div>
				<div class="table-container-wrapper">
					<div class="table-container">
						<table class="sahayog-table">
							<thead>
								<tr>
									<th class="row-label">Row Labels</th>
									<th>Branches</th>
									<th>DEC-25</th>
									<th>JAN-26</th>
									<th>FEB-26</th>
									<th>MAR-26</th>
									<th>Total</th>
								</tr>
							</thead>
							<tbody id="dashboard-tbody">
								<tr class="loading-row">
									<td colspan="7">
										<i class="fa fa-spinner fa-spin"></i> Loading...
									</td>
								</tr>
							</tbody>
							<tfoot id="dashboard-tfoot"></tfoot>
						</table>
					</div>
				</div>
			`);

		this.attachDashboardEventListeners();

		// Insert compact timeline
		try {
			const groupingToggle = container.find(".grouping-toggle");
			if (groupingToggle.length) {
				groupingToggle.after(this.createCompactTimeline());
			}
		} catch (e) {
			console.error("Failed to insert timeline:", e);
		}

		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_dashboard_data",
			args: {
				selected_date: this.selectedDate,
				filters: this.getFiltersJSON(),
				target_type: this.targetType,
			},
			callback: (r) => {
				if (r.message) {
					const transformedData = this.transformPythonData(r.message);
					this.rawData = transformedData;
					this.renderDashboard(transformedData);
					this.updateCategoryCounts(transformedData);
				} else {
					$("#dashboard-tbody").html(`
							<tr><td colspan="7" style="text-align:center; padding:40px;">
								No data available for the selected filters
							</td></tr>
						`);
				}
			},
		});
	}

	transformPythonData(flatData) {
		const zoneMap = {};

		flatData.forEach((row) => {
			const zoneName = row.zone || "Unknown";
			const categoryName = row.category || "Unknown";

			if (!zoneMap[zoneName]) {
				zoneMap[zoneName] = {
					zone: zoneName,
					branch_count: 0,
					dec: { tgt: 0, ach: 0, available: false },
					jan: { tgt: 0, ach: 0, available: false },
					feb: { tgt: 0, ach: 0, available: false },
					mar: { tgt: 0, ach: 0, available: false },
					total: { tgt: 0, ach: 0 },
					categories: {},
				};
			}

			if (!zoneMap[zoneName].categories[categoryName]) {
				zoneMap[zoneName].categories[categoryName] = {
					category: categoryName,
					branch_count: 0,
					dec: { tgt: 0, ach: 0, available: false },
					jan: { tgt: 0, ach: 0, available: false },
					feb: { tgt: 0, ach: 0, available: false },
					mar: { tgt: 0, ach: 0, available: false },
					total: { tgt: 0, ach: 0 },
				};
			}

			zoneMap[zoneName].branch_count += row.branch_count || 0;
			["dec", "jan", "feb", "mar"].forEach((month) => {
				zoneMap[zoneName][month].tgt += row[month].tgt || 0;
				zoneMap[zoneName][month].ach += row[month].ach || 0;
				if (row[month].available) {
					zoneMap[zoneName][month].available = true;
				}
			});
			zoneMap[zoneName].total.tgt += row.total.tgt || 0;
			zoneMap[zoneName].total.ach += row.total.ach || 0;

			const cat = zoneMap[zoneName].categories[categoryName];
			cat.branch_count += row.branch_count || 0;
			["dec", "jan", "feb", "mar"].forEach((month) => {
				cat[month].tgt += row[month].tgt || 0;
				cat[month].ach += row[month].ach || 0;
				if (row[month].available) {
					cat[month].available = true;
				}
			});
			cat.total.tgt += row.total.tgt || 0;
			cat.total.ach += row.total.ach || 0;
		});

		const zones = Object.values(zoneMap).map((zone) => ({
			...zone,
			categories: Object.values(zone.categories),
		}));

		const grand_total = {
			branch_count: 0,
			dec: { tgt: 0, ach: 0, available: false },
			jan: { tgt: 0, ach: 0, available: false },
			feb: { tgt: 0, ach: 0, available: false },
			mar: { tgt: 0, ach: 0, available: false },
			total: { tgt: 0, ach: 0 },
		};

		zones.forEach((zone) => {
			grand_total.branch_count += zone.branch_count;
			["dec", "jan", "feb", "mar"].forEach((month) => {
				grand_total[month].tgt += zone[month].tgt;
				grand_total[month].ach += zone[month].ach;
				if (zone[month].available) {
					grand_total[month].available = true;
				}
			});
			grand_total.total.tgt += zone.total.tgt;
			grand_total.total.ach += zone.total.ach;
		});

		return { zones, grand_total };
	}

	attachDashboardEventListeners() {
		$(".grouping-btn")
			.off("click")
			.on("click", (e) => {
				const group = $(e.currentTarget).data("group");
				this.switchGrouping(group);
			});

		$("#toggle-all-rows")
			.off("click")
			.on("click", () => this.toggleAllRows());

		// Chart visualize dropdown
		$(document)
			.off("click.dashboard_chart")
			.on("click.dashboard_chart", (e) => {
				if (
					!$(e.target).closest(
						"#chart-visualize-btn, #chart-dropdown, .chart-visualize-wrapper"
					).length
				) {
					$("#chart-dropdown").removeClass("show");
				}
			});

		$("#chart-visualize-btn")
			.off("click")
			.on("click", (e) => {
				e.stopPropagation();
				$("#chart-dropdown").toggleClass("show");
			});

		$(".chart-dropdown-item")
			.off("click")
			.on("click", (e) => {
				const chart = $(e.currentTarget).data("chart");
				$("#chart-dropdown").removeClass("show");
				this.openChartModal(chart);
			});
	}

	switchGrouping(group) {
		this.groupBy = group;
		$(".grouping-btn").removeClass("active");
		$(`.grouping-btn[data-group="${group}"]`).addClass("active");
		this.saveState();
		this.loadDashboardData();
	}

	toggleAllRows() {
		this.allExpanded = !this.allExpanded;
		const btn = $("#toggle-all-rows");
		const icon = btn.find("i");
		const text = btn.find("span");

		if (this.allExpanded) {
			this.collapsedGroups.clear();
			$(".group-row").removeClass("collapsed");
			$(".child-row").removeClass("hidden");
			icon.removeClass("fa-expand-alt").addClass("fa-compress-alt");
			text.text("Collapse All");
		} else {
			$(".group-row").each((i, row) => {
				const idx = $(row).data("idx");
				this.collapsedGroups.add(idx);
			});
			$(".group-row").addClass("collapsed");
			$(".child-row").addClass("hidden");
			icon.removeClass("fa-compress-alt").addClass("fa-expand-alt");
			text.text("Expand All");
		}
	}

	renderDashboard(data) {
		const tbody = $("#dashboard-tbody");
		const tfoot = $("#dashboard-tfoot");
		tbody.empty();
		tfoot.empty();
		this.collapsedGroups.clear();

		if (data.zones && data.zones.length > 0) {
			if (this.groupBy === "zone") {
				this.renderZoneGrouping(data, tbody);
			} else {
				this.renderCategoryGrouping(data, tbody);
			}

			if (data.grand_total) {
				tfoot.append(this.createGrandTotalRow(data.grand_total));
			}
		} else {
			tbody.append(`
					<tr>
						<td colspan="7" style="text-align:center; padding:40px;">
							No data available for the selected filters
						</td>
					</tr>
				`);
		}

		this.attachRowEvents();
	}

	renderZoneGrouping(data, tbody) {
		data.zones.forEach((zone, idx) => {
			this.collapsedGroups.add(idx);
			tbody.append(this.createGroupRow(zone.zone, zone, idx));

			this.getSortedCategories(zone.categories).forEach((cat) => {
				tbody.append(this.createChildRow(cat, idx, zone.zone, cat.category));
			});
		});
	}

	renderCategoryGrouping(data, tbody) {
		const categoryData = this.transformToCategoryGrouping(data);

		categoryData.forEach((cat, idx) => {
			this.collapsedGroups.add(idx);
			tbody.append(this.createGroupRow(cat.category, cat, idx));

			const sortedZones = cat.zones.sort((a, b) => a.zone.localeCompare(b.zone));
			sortedZones.forEach((zone) => {
				tbody.append(this.createChildRow(zone, idx, zone.zone, zone.category));
			});
		});
	}

	getSortedCategories(categories) {
		const order = this.availableCategories;
		return categories.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
	}

	transformToCategoryGrouping(data) {
		const categoryMap = {};

		this.availableCategories.forEach((cat) => {
			categoryMap[cat] = {
				category: cat,
				branch_count: 0,
				dec: { tgt: 0, ach: 0, available: false },
				jan: { tgt: 0, ach: 0, available: false },
				feb: { tgt: 0, ach: 0, available: false },
				mar: { tgt: 0, ach: 0, available: false },
				total: { tgt: 0, ach: 0 },
				zones: [],
			};
		});

		data.zones.forEach((zone) => {
			zone.categories.forEach((cat) => {
				if (categoryMap[cat.category]) {
					categoryMap[cat.category].branch_count += cat.branch_count || 0;
					["dec", "jan", "feb", "mar"].forEach((month) => {
						categoryMap[cat.category][month].tgt += cat[month].tgt || 0;
						categoryMap[cat.category][month].ach += cat[month].ach || 0;
						if (cat[month].available) {
							categoryMap[cat.category][month].available = true;
						}
					});
					categoryMap[cat.category].total.tgt += cat.total.tgt || 0;
					categoryMap[cat.category].total.ach += cat.total.ach || 0;

					categoryMap[cat.category].zones.push({
						zone: zone.zone,
						category: cat.category,
						branch_count: cat.branch_count,
						dec: cat.dec,
						jan: cat.jan,
						feb: cat.feb,
						mar: cat.mar,
						total: cat.total,
					});
				}
			});
		});

		return Object.values(categoryMap).filter((cat) => cat.branch_count > 0);
	}

	createGroupRow(label, data, idx) {
		const groupType = this.groupBy === "zone" ? "zone" : "category";
		const g = this.computeGroupIndicator(label, groupType);

		// Calculate total + and total - for the group
		let totalIncrease = 0;
		let totalDecrease = 0;
		if (this.comparisonResult && this.comparisonResult.comparison_rows) {
			this.comparisonResult.comparison_rows.forEach((r) => {
				let isMatching = false;
				if (groupType === "zone" && r.zone === label) {
					isMatching = true;
				} else if (groupType === "category" && r.category === label) {
					isMatching = true;
				}

				if (isMatching) {
					const diff = (r.current_branch_count || 0) - (r.previous_branch_count || 0);
					if (diff > 0) {
						totalIncrease += diff;
					} else if (diff < 0) {
						totalDecrease += Math.abs(diff);
					}
				}
			});
		}

		const indicatorClass = g && g.diff !== 0 ? "cmp-indicator-clickable" : "";
		let indicatorHtml = "";
		if (g) {
			// ✅ FIX: Determine zone and category based on grouping
			const zoneAttr = this.groupBy === "zone" ? label : "ALL";
			const categoryAttr = this.groupBy === "category" ? label : "ALL";

			if (totalIncrease > 0 || totalDecrease > 0) {
				indicatorHtml = ` <span class="cmp-indicator ${indicatorClass}" title="Total ↑${totalIncrease}, Total ↓${totalDecrease}" data-zone="${zoneAttr}" data-category="${categoryAttr}" data-diff="${g.diff}">
					<span style="color:green; font-weight:bold;">↑${totalIncrease}</span>
					<span style="color:red; font-weight:bold;">↓${totalDecrease}</span>
				</span>`;
			} else {
				indicatorHtml = ` <span class="cmp-indicator ${g.color} ${indicatorClass}" title="${g && g.diff !== 0 ? 'Hover for branch details' : ''}" data-zone="${zoneAttr}" data-category="${categoryAttr}" data-diff="${g.diff}">${g.indicator} ${g.display}</span>`;
			}
		}

		return `
				<tr class="group-row ${this.collapsedGroups.has(idx) ? "collapsed" : ""}" data-idx="${idx}">
					<td class="row-label">
						<span class="collapse-icon">&#9662;</span> ${label}
					</td>
					<td>${data.branch_count}${indicatorHtml}</td>
					<td>${this.formatTgtAch(data.dec)}</td>
					<td>${this.formatTgtAch(data.jan)}</td>
					<td>${this.formatTgtAch(data.feb)}</td>
					<td>${this.formatTgtAch(data.mar)}</td>
					<td>${this.formatTgtAch(data.total)}</td>
				</tr>
			`;
	}

	createChildRow(data, groupIdx, zone, category) {
		const label = this.groupBy === "zone" ? category : zone;
		const catClass = this.getCategoryClass(category);

		const cmp = this.findComparisonRow(zone, category);
		let cmpHtml = "";
		if (cmp) {
			const indicatorClass = cmp.difference !== 0 ? "cmp-indicator-clickable" : "";
			cmpHtml = ` <span class="cmp-indicator ${
				cmp.indicator_color
			} ${indicatorClass}" title="${
				cmp.difference !== 0 ? "Hover for branch details" : ""
			}" data-zone="${zone}" data-category="${category}" data-diff="${cmp.difference}">${
				cmp.indicator
			} ${cmp.difference_display}</span>`;
		}

		return `
				<tr class="child-row ${catClass} child-${groupIdx} ${
			this.collapsedGroups.has(groupIdx) ? "hidden" : ""
		}" 
					data-zone="${zone}" data-category="${category}">
					<td class="row-label">${label}</td>
					<td style="cursor:pointer; color:#000; font-weight:700;">${data.branch_count}${cmpHtml}</td>
					<td>${this.formatTgtAch(data.dec)}</td>
					<td>${this.formatTgtAch(data.jan)}</td>
					<td>${this.formatTgtAch(data.feb)}</td>
					<td>${this.formatTgtAch(data.mar)}</td>
					<td>${this.formatTgtAch(data.total)}</td>
				</tr>
			`;
	}

	createGrandTotalRow(total) {
		return `
				<tr class="grand-total-row">
					<td class="row-label">Grand Total</td>
					<td>${total.branch_count}</td>
					<td>${this.formatTgtAch(total.dec)}</td>
					<td>${this.formatTgtAch(total.jan)}</td>
					<td>${this.formatTgtAch(total.feb)}</td>
					<td>${this.formatTgtAch(total.mar)}</td>
					<td>${this.formatTgtAch(total.total)}</td>
				</tr>
			`;
	}

	getCategoryClass(category) {
		const map = {
			Pinnacle: "cat-Pinnacle",
			Master: "cat-master",
			Accelerator: "cat-accelerator",
			Starter: "cat-starter",
			Learner: "cat-learner",
			"Zero Level": "cat-zero",
		};
		return map[category] || "";
	}

	formatNumber(num) {
		// Return full amount formatted as Indian Rupees (no shortcuts)
		if (num === null || num === undefined || num === "" || isNaN(num)) {
			return "₹0";
		}

		num = Number(num);
		try {
			const fmt = new Intl.NumberFormat("en-IN", {
				style: "currency",
				currency: "INR",
				maximumFractionDigits: 0,
			});
			return fmt.format(num);
		} catch (e) {
			// Fallback
			return "₹" + num.toLocaleString("en-IN");
		}
	}

	formatTgtAch(data) {
		if (!data) {
			return `<div class="tgt-ach-cell"><span class="na-text">N/A</span></div>`;
		}

		const tgt = data.tgt || 0;
		const ach = data.ach || 0;
		const available = data.available || false;

		if (!available) {
			return `
					<div class="tgt-ach-cell">
						<div class="tgt-line">T: ${this.formatNumber(tgt)}</div>
						<div class="na-text">A: N/A</div>
					</div>
				`;
		}

		// Calculate percentage
		const pct = tgt > 0 ? ((ach / tgt) * 100).toFixed(1) : 0;
		const pctClass =
			pct >= 100 ? "ach-high" : pct >= 75 ? "ach-good" : pct >= 50 ? "ach-avg" : "ach-low";

		return `
				<div class="tgt-ach-cell">
					<div class="tgt-line">T: ${this.formatNumber(tgt)}</div>
					<div class="ach-line ${pctClass}">A: ${this.formatNumber(ach)} (${pct}%)</div>
				</div>
			`;
	}

	attachRowEvents() {
		$(".group-row")
			.off("click")
			.on("click", (e) => {
				const idx = $(e.currentTarget).data("idx");
				this.toggleGroup(idx);
			});

		$(".group-row td:nth-child(2)")
			.off("click")
			.on("click", (e) => {
				e.stopPropagation();
				if (this.groupBy === "category") {
					const groupRow = $(e.currentTarget).closest("tr");
					const category = groupRow
						.find(".row-label")
						.clone()
						.children()
						.remove()
						.end()
						.text()
						.trim();
					if (category) {
						this.openDrillDown("ALL", category);
					}
				} else if (this.groupBy === "zone") {
					// Zone group row click: show category breakdown for this zone
					const groupRow = $(e.currentTarget).closest("tr");
					const zone = groupRow
						.find(".row-label")
						.clone()
						.children()
						.remove()
						.end()
						.text()
						.trim();
					if (zone) {
						this.showZoneCategoryBreakdownTable(zone);
					}
				}
			});

		$(".child-row td:nth-child(2)")
			.off("click")
			.on("click", (e) => {
				const row = $(e.currentTarget).closest("tr");
				const zone = row.data("zone");
				const category = row.data("category");
				this.openDrillDown(zone, category);
			});
	}

	toggleGroup(idx) {
		const groupRow = $(`.group-row[data-idx="${idx}"]`);
		const childRows = $(`.child-${idx}`);

		if (this.collapsedGroups.has(idx)) {
			this.collapsedGroups.delete(idx);
			groupRow.removeClass("collapsed");
			childRows.removeClass("hidden");
		} else {
			this.collapsedGroups.add(idx);
			groupRow.addClass("collapsed");
			childRows.addClass("hidden");
		}
	}

	updateDrillDownHeaderButtons() {
		$(".drill-target-type-btn").removeClass("active");
		$(`.drill-target-type-btn[data-type="${this.targetType}"]`).addClass("active");
	}

	openDrillDown(zone, category) {
		this.currentZone = zone;
		this.currentCategory = category;

		const titleText = zone === "ALL" ? `${category} - All Zones` : `${zone} - ${category}`;
		$("#drill-title").text(titleText);
		$("#drill-down-view").addClass("active");
		this.updateDrillDownHeaderButtons();
		$(
			".timeline-container, .combined-filters, .active-filter-indicator, .sahayog-content"
		).hide();

		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_drill_down_data",
			args: {
				zone: zone,
				category: category,
				selected_date: this.selectedDate,
				filters: this.getFiltersJSON(),
				target_type: this.targetType,
			},
			callback: (r) => {
				if (r.message) {
					this.allDrillData = r.message;
					this.renderDrillDown(r.message);
				}
			},
		});
	}

	closeDrillDown() {
		$("#drill-down-view").removeClass("active");
		$(
			".timeline-container, .combined-filters, .active-filter-indicator, .sahayog-content"
		).show();
	}
	renderDrillDown(response) {
		const container = $("#drill-segments-container");
		container.empty();

		if (!response || !response.branches || response.branches.length === 0) {
			container.html(`
				<div style="text-align:center; padding:40px; color:#666; background:#f8fafc; border-radius:8px;">
					<div style="font-size:48px; margin-bottom:16px; opacity:0.5;">📭</div>
					<div style="font-size:14px; font-weight:600; margin-bottom:8px;">No Data Available</div>
					<div style="font-size:12px; color:#94a3b8;">No branches found for the selected filters</div>
				</div>
			`);
			return;
		}

		this.allDrillData = response; // Store for filtering
		const allBranches = response.branches;

		const zoneSorter = (a, b) => {
			const getSortKey = (zoneName) => {
				if (zoneName && zoneName.startsWith("ZONE-")) {
					try {
						const zoneNum = parseInt(zoneName.split("-")[1], 10);
						if (!isNaN(zoneNum)) {
							return [0, zoneNum];
						}
					} catch (e) {
						// fall through
					}
				}
				return [1, zoneName]; // Non "ZONE-X" formats come after
			};

			const keyA = getSortKey(a);
			const keyB = getSortKey(b);

			if (keyA[0] < keyB[0]) return -1;
			if (keyA[0] > keyB[0]) return 1;

			if (keyA[1] < keyB[1]) return -1;
			if (keyA[1] > keyB[1]) return 1;

			return 0;
		};

		const uniqueZonesFromData = [...new Set(allBranches.map((b) => b.zone).filter((z) => z))];
		uniqueZonesFromData.sort(zoneSorter);
		const uniqueZones = ["All", ...uniqueZonesFromData];

		const uniqueRegionsFromData = [
			...new Set(allBranches.map((b) => b.region).filter((r) => r)),
		];
		uniqueRegionsFromData.sort(); // Alphabetical sort
		const uniqueRegions = ["All", ...uniqueRegionsFromData];

		// 1. FILTERS
		const filtersHtml = `
			<div class="drill-down-filters">
				<div class="filter-group">
					<label for="drill-sol-filter">Filter by SOL ID or Branch Name</label>
					<input type="text" id="drill-sol-filter" placeholder="e.g., 12345 or 'Main Branch'">
				</div>
				<div class="filter-group">
					<label for="drill-zone-filter">Filter by Zone</label>
					<select id="drill-zone-filter">
						${uniqueZones.map((z) => `<option value="${z}">${z}</option>`).join("")}
					</select>
				</div>
				<div class="filter-group">
					<label for="drill-region-filter">Filter by Region</label>
					<select id="drill-region-filter">
						${uniqueRegions.map((r) => `<option value="${r}">${r}</option>`).join("")}
					</select>
				</div>
			</div>
		`;
		container.append(filtersHtml);

		// 2. UNIFIED TABLE
		const tableHtml = `
			<div class="table-container-wrapper" style="max-height: 70vh;">
				<table class="sahayog-table">
					<thead>
						<tr>
							<th>Sr. No.</th>
							<th class="row-label">Branch Name</th>
							<th>SOL ID</th>
							<th>Zone</th>
							<th>Region</th>
							<th>Target</th>
							<th>Achievement</th>
							<th>% Achievement</th>
							<th>Performance Category</th>
						</tr>
					</thead>
					<tbody id="drill-down-tbody-unified">
					</tbody>
				</table>
			</div>
		`;
		container.append(tableHtml);

		// 3. RENDER TABLE BODY
		this._renderDrillDownTableBody(allBranches);

		// 4. ATTACH FILTER EVENTS
		$("#drill-sol-filter, #drill-zone-filter, #drill-region-filter").on("input", () => {
			this.drillDownFilters.sol = $("#drill-sol-filter").val().toLowerCase();
			this.drillDownFilters.zone = $("#drill-zone-filter").val();
			this.drillDownFilters.region = $("#drill-region-filter").val();
			this._applyDrillDownFilters();
		});
	}

	_applyDrillDownFilters() {
		let filteredBranches = this.allDrillData.branches;

		// SOL / Branch Name Filter
		if (this.drillDownFilters.sol) {
			filteredBranches = filteredBranches.filter((b) => {
				const solMatch =
					b.sol_id && b.sol_id.toLowerCase().includes(this.drillDownFilters.sol);
				const nameMatch =
					b.branch_name &&
					b.branch_name.toLowerCase().includes(this.drillDownFilters.sol);
				return solMatch || nameMatch;
			});
		}

		// Zone Filter
		if (this.drillDownFilters.zone && this.drillDownFilters.zone !== "All") {
			filteredBranches = filteredBranches.filter(
				(b) => b.zone === this.drillDownFilters.zone
			);
		}

		// Region Filter
		if (this.drillDownFilters.region && this.drillDownFilters.region !== "All") {
			filteredBranches = filteredBranches.filter(
				(b) => b.region === this.drillDownFilters.region
			);
		}

		this._renderDrillDownTableBody(filteredBranches);
	}

	_getSegmentForBranch(branchIndex, segments) {
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			if (branchIndex >= seg.start_index && branchIndex < seg.end_index) {
				const segmentName = seg.segment_name;
				let colorClass = "";
				let badgeColor = "";

				switch (i) {
					case 0: // TOP 25%
						colorClass = "perf-top-row";
						badgeColor = "green";
						break;
					case 1: // NEXT 25%
						colorClass = "perf-next-row";
						badgeColor = "blue";
						break;
					case 2: // MID 25%
						colorClass = "perf-mid-row";
						badgeColor = "orange";
						break;
					case 3: // BOTTOM 25%
						colorClass = "perf-bottom-row";
						badgeColor = "red";
						break;
				}
				return { name: segmentName, colorClass, badgeColor };
			}
		}
		return { name: "N/A", colorClass: "", badgeColor: "grey" };
	}

	_renderDrillDownTableBody(branches) {
		const tbody = $("#drill-down-tbody-unified");
		tbody.empty();

		if (branches.length === 0) {
			tbody.html(
				`<tr><td colspan="8" style="text-align:center; padding: 40px;">No branches match the current filters.</td></tr>`
			);
			return;
		}

		const original_branches = this.allDrillData.branches;
		const segments = this.allDrillData.segments;

		branches.forEach((branch, index) => {
			const originalIndex = original_branches.findIndex((b) => b.sol_id === branch.sol_id);
			const segmentInfo = this._getSegmentForBranch(originalIndex, segments);

			const rowHtml = `
				<tr class="${segmentInfo.colorClass}">
					<td>${index + 1}</td>
					<td class="row-label branch-name-cell" data-sol-id="${branch.sol_id}" style="cursor:pointer;">${
				branch.branch_name
			}</td>
					<td>${branch.sol_id}</td>
					<td>${branch.zone}</td>
					<td>${branch.region}</td>
					<td>${this.formatNumber(branch.yearly_target)}</td>
					<td>${this.formatNumber(branch.total_ach)}</td>
					<td>${branch.ach_pct.toFixed(2)}%</td>
					<td>
						<span class="perf-badge ${segmentInfo.badgeColor}">
							${segmentInfo.name}
						</span>
					</td>
				</tr>
			`;
			tbody.append(rowHtml);
		});
	}

	// New function for enhanced table
	createEnhancedDrillDownTable(branches, segmentName) {
		// This function is now OBSOLETE and REPLACED by the unified table logic in `renderDrillDown`.
		// Kept here to avoid breaking changes if it's called from somewhere else unexpectedly,
		// but it should not be used in the new flow.
		console.warn("createEnhancedDrillDownTable is obsolete and should not be used.");
		return "<div></div>";
	}

	// Helper functions
	formatNumberShort(num) {
		if (!num) return "0";
		num = parseFloat(num);

		if (num >= 10000000) {
			return (num / 10000000).toFixed(1) + "Cr";
		} else if (num >= 100000) {
			return (num / 100000).toFixed(1) + "L";
		} else if (num >= 1000) {
			return (num / 1000).toFixed(1) + "K";
		}
		return num.toFixed(0);
	}

	getPercentageColor(pct) {
		if (pct >= 100) return "#dcfce7";
		if (pct >= 80) return "#bbf7d0";
		if (pct >= 60) return "#fef3c7";
		if (pct >= 40) return "#fed7aa";
		return "#fecaca";
	}

	formatDate(dateStr) {
		const date = new Date(dateStr);
		return date.toLocaleDateString("en-IN", {
			day: "2-digit",
			month: "short",
			year: "numeric",
		});
	}

	createDrillDownTable(items) {
		let tableHtml = `
				<div style="overflow-x:auto;">
					<table style="width:100%; border-collapse:collapse; font-size:12px;">
						<thead>
							<tr style="background:#f8fafc; border-bottom:2px solid #e2e8f0;">
								<th style="padding:10px 12px; text-align:left; font-weight:600;">Branch</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">Zone</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">SOL ID</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">Region</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">District</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">DEC-25</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">JAN-26</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">FEB-26</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">MAR-26</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">Total</th>
								<th style="padding:10px 12px; text-align:center; font-weight:600;">%</th>
							</tr>
						</thead>
						<tbody>
			`;

		items.forEach((b, index) => {
			const rowClass = index % 2 === 0 ? "background:#ffffff" : "background:#fafafa";
			const pctClass =
				b.ach_pct >= 100
					? "background:#22c55e"
					: b.ach_pct >= 75
					? "background:#86efac"
					: b.ach_pct >= 50
					? "background:#fbbf24"
					: "background:#fca5a5";

			tableHtml += `
					<tr style="${rowClass}; border-bottom:1px solid #f1f5f9;">
						<td style="padding:10px 12px; font-weight:600;">${b.branch_name || b.branch}</td>
						<td style="padding:10px 12px; text-align:center;">${b.zone || "-"}</td>
						<td style="padding:10px 12px; text-align:center; font-family:monospace;">${b.sol_id || "-"}</td>
						<td style="padding:10px 12px; text-align:center;">${b.region || "-"}</td>
						<td style="padding:10px 12px; text-align:center;">${b.district || "-"}</td>
						<td style="padding:10px 12px; text-align:center;">${this.formatTgtAch(b.dec)}</td>
						<td style="padding:10px 12px; text-align:center;">${this.formatTgtAch(b.jan)}</td>
						<td style="padding:10px 12px; text-align:center;">${this.formatTgtAch(b.feb)}</td>
						<td style="padding:10px 12px; text-align:center;">${this.formatTgtAch(b.mar)}</td>
						<td style="padding:10px 12px; text-align:center;">${this.formatTgtAch(b.total)}</td>
						<td style="padding:10px 12px; text-align:center;">
							<span style="display:inline-block; padding:4px 8px; border-radius:12px; color:#1e293b; font-weight:700; ${pctClass}">
								${b.ach_pct.toFixed(1)}%
							</span>
						</td>
					</tr>
				`;
		});

		tableHtml += `
						</tbody>
					</table>
				</div>
			`;

		return tableHtml;
	}

	loadBranchTargets() {
		const container = $("#branch-targets-view");
		container.html(`
				<div class="table-container-wrapper">
					<table class="sahayog-table">
						<thead>
							<tr>
								<th class="row-label">SOL ID</th>
								<th>Target</th>
								<th>Financial Year</th>
								<th>Type</th>
							</tr>
						</thead>
						<tbody id="targets-tbody">
							<tr class="loading-row">
								<td colspan="4"><i class="fa fa-spinner fa-spin"></i> Loading...</td>
							</tr>
						</tbody>
					</table>
				</div>
			`);

		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_branch_targets",
			args: { selected_date: this.selectedDate },
			callback: (r) => {
				if (r.message) {
					this.renderBranchTargets(r.message);
				}
			},
		});
	}

	renderBranchTargets(targets) {
		const tbody = $("#targets-tbody");
		tbody.empty();

		if (!targets || targets.length === 0) {
			tbody.html(
				`<tr><td colspan="4" style="text-align:center; padding:40px;">No targets found</td></tr>`
			);
			return;
		}

		targets.forEach((t, index) => {
			const rowClass = index % 2 === 0 ? "" : "background:#fafafa";
			tbody.append(`
						<tr style="${rowClass}">
							<td class="row-label" style="font-weight:600;">${t.sol_id}</td>
							<td style="font-weight:700; color:#000;">${this.formatNumber(t.target)}</td>
							<td>${t.financial_year}</td>
							<td>
								<span style="padding:5px 12px; background:#000; color:white; border-radius:14px; font-size:11px; font-weight:600;">
									${t.type}
								</span>
							</td>
						</tr>
					`);
		});
	}

	openBranchProfile(sol_id) {
		frappe.call({
			method: "custom_report.custom_report.page.sahayog_dashboard.sahayog_dashboard.get_branch_profile",
			args: {
				sol_id: sol_id,
				selected_date: this.selectedDate,
			},
			callback: (r) => {
				if (r.message) {
					this.renderBranchProfile(r.message);
				}
			},
		});
	}

	renderBranchProfile(data) {
		// Create or show branch profile modal
		const modalHtml = `
        <div class="branch-profile-modal" id="branch-profile-modal">
            <div class="branch-profile-content">
                <!-- Header -->
                <div class="branch-profile-header">
                    <div>
                        <div style="font-size:20px; font-weight:700;">${data.branch}</div>
                        <div style="font-size:13px; opacity:0.9; margin-top:4px;">
                            SOL ID: ${data.sol_id} • ${data.zone} • ${data.region} • ${
			data.district
		} • ${data.state}
                        </div>
                    </div>
                    <button class="branch-profile-close" id="branch-profile-close">
                        <i class="fa fa-times"></i> Close
                    </button>
                </div>

                <!-- Body -->
                <div class="branch-profile-body">
                    <!-- Category Badges -->
                    <div style="margin-bottom:20px; display:flex; gap:12px; align-items:center;">
                        <div>
                            <div style="font-size:11px; color:#64748b; margin-bottom:4px; font-weight:600;">STORED CATEGORY</div>
                            <span class="category-badge ${this.getCategoryClass(data.category)}">
                                ${data.category}
                            </span>
                        </div>
                        <div style="font-size:20px; color:#cbd5e1;">→</div>
                        <div>
                            <div style="font-size:11px; color:#64748b; margin-bottom:4px; font-weight:600;">CALCULATED CATEGORY</div>
                            <span class="category-badge ${this.getCategoryClass(
								data.calculated_category
							)}">
                                ${data.calculated_category}
                            </span>
                        </div>
                    </div>

                    <!-- Summary Cards -->
                    <div class="profile-summary-cards">
                        <div class="profile-card">
                            <div class="profile-card-label">Current Month (${
								data.current_month.month
							})</div>
                            <div class="profile-card-value">${this.formatNumber(
								data.current_month.achievement
							)}</div>
                            <div style="font-size:11px; color:#64748b; margin-top:4px;">
                                Target: ${this.formatNumber(data.current_month.target)} (${
			data.current_month.percentage
		}%)
                            </div>
                        </div>
                        <div class="profile-card">
                            <div class="profile-card-label">Yearly Achievement</div>
                            <div class="profile-card-value">${this.formatNumber(
								data.yearly.achievement
							)}</div>
                            <div style="font-size:11px; color:#64748b; margin-top:4px;">
                                Target: ${this.formatNumber(data.yearly.target)} (${
			data.yearly.percentage
		}%)
                            </div>
                        </div>
                        <div class="profile-card">
                            <div class="profile-card-label">YTD Achievement</div>
                            <div class="profile-card-value">${this.formatNumber(
								data.ytd.achievement
							)}</div>
                            <div style="font-size:11px; color:#64748b; margin-top:4px;">
                                Target: ${this.formatNumber(data.ytd.target)} (${
			data.ytd.percentage
		}%)
                            </div>
                        </div>
                    </div>

                    <!-- Monthly Performance -->
                    <div class="profile-section">
                        <h3>Monthly Performance</h3>
                        <table class="profile-table">
                            <thead>
                                <tr>
                                    <th>Month</th>
                                    <th>Target</th>
                                    <th>Achievement</th>
                                    <th>%</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Object.keys(data.monthly)
									.map((month) => {
										const m = data.monthly[month];
										const pct =
											m.tgt > 0 ? ((m.ach / m.tgt) * 100).toFixed(1) : "0.0";
										return `
                                        <tr>
                                            <td>${month.toUpperCase()}</td>
                                            <td>${this.formatNumber(m.tgt)}</td>
                                            <td>${this.formatNumber(m.ach)}</td>
                                            <td>${pct}%</td>
                                        </tr>
                                    `;
									})
									.join("")}
                            </tbody>
                        </table>
                    </div>

                    <!-- Yearly & YTD Summary -->
                    <div class="profile-section">
                        <h3>Overall Performance</h3>
                        <div class="performance-summary">
                            <div class="perf-item">
                                <div class="perf-label">Yearly</div>
                                <div class="perf-bar">
                                    <div class="perf-bar-fill" style="width:${Math.min(
										data.yearly.percentage,
										100
									)}%;"></div>
                                </div>
                                <div class="perf-stats">
                                    ${this.formatNumber(
										data.yearly.achievement
									)} / ${this.formatNumber(data.yearly.target)} (${
			data.yearly.percentage
		}%)
                                </div>
                            </div>
                            <div class="perf-item">
                                <div class="perf-label">YTD (Dec to Current)</div>
                                <div class="perf-bar">
                                    <div class="perf-bar-fill" style="width:${Math.min(
										data.ytd.percentage,
										100
									)}%;"></div>
                                </div>
                                <div class="perf-stats">
                                    ${this.formatNumber(
										data.ytd.achievement
									)} / ${this.formatNumber(data.ytd.target)} (${
			data.ytd.percentage
		}%)
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

		// Remove existing modal if any
		$("#branch-profile-modal").remove();

		// Append and show
		$("body").append(modalHtml);
		$("#branch-profile-modal").addClass("show");

		// Close handler
		$("#branch-profile-close").on("click", () => {
			$("#branch-profile-modal").removeClass("show");
			setTimeout(() => $("#branch-profile-modal").remove(), 300);
		});
	}
}
