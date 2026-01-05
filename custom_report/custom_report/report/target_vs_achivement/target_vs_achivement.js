frappe.query_reports["Target Vs Achivement"] = {
	filters: [
		{
			fieldname: "zone",
			label: "Zone",
			fieldtype: "Data",
		},
		{
			fieldname: "region",
			label: "Region",
			fieldtype: "Data",
		},
		{
			fieldname: "district",
			label: "District",
			fieldtype: "Data",
		},
		{
			fieldname: "branch",
			label: "Branch",
			fieldtype: "Data",
		},
		{
			fieldname: "type",
			label: "Target Type",
			fieldtype: "Select",
			options: "\nMonthly\nYearly\nYTD",
			default: "Monthly",
			reqd: 1,
		},
		{
			fieldname: "date",
			label: "Date",
			fieldtype: "Date",
			default: frappe.datetime.get_today(),
			reqd: 1,
		},
		{
			fieldname: "compare_type",
			label: "Compare",
			fieldtype: "Select",
			options: "\nDaily\nMonthly\nYearly",
			default: "Daily",
		},
		{
			fieldname: "sort_mode",
			label: "Sort By",
			fieldtype: "Select",
			options: "\nCategory Wise\nZone Wise", // ✅ Updated values
			default: "Category Wise", // ✅ Updated default
		},
	],

	onload: function (report) {
		const date_filter = report.get_filter("date");

		if (!date_filter.get_value()) {
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Branch Category Report",
					fields: ["date"],
					order_by: "date desc",
					limit_page_length: 1,
				},
				callback: function (r) {
					if (r.message && r.message.length) {
						const max_date = r.message[0].date;
						date_filter.set_value(max_date);
						report.refresh();
					}
				},
			});
		}
	},
};
