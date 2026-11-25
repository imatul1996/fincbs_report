const existing_share_app_list = frappe.listview_settings["Share Application"] || {};
const existing_share_app_refresh = existing_share_app_list.refresh;

frappe.listview_settings["Share Application"] = Object.assign(existing_share_app_list, {
	refresh(listview) {
		if (typeof existing_share_app_refresh === "function") {
			existing_share_app_refresh.call(this, listview);
		}

		if (!frappe.boot.developer_mode) return;
		if (listview.page.__custom_report_sync_cif_added) return;
		listview.page.__custom_report_sync_cif_added = true;

		listview.page.add_inner_button(__("Sync by CIF"), () => {
			const d = new frappe.ui.Dialog({
				title: __("Sync Share Application by CIF"),
				fields: [
					{
						label: __("CIF ID"),
						fieldname: "cif_id",
						fieldtype: "Data",
						reqd: 1,
						placeholder: __("Enter CIF ID"),
					},
				],
				primary_action_label: __("Sync"),
				primary_action(values) {
					d.disable_primary_action();
					frappe.call({
						method: "custom_report.api.share_application_sync.sync_share_application_by_cif",
						args: { cif_id: values.cif_id },
						freeze: true,
						freeze_message: __("Syncing CIF and Loan Accounts..."),
						callback(r) {
							d.enable_primary_action();
							const res = r.message || {};
							const indicator =
								res.status === "success"
									? "green"
									: res.status === "exists"
									? "blue"
									: "red";
							frappe.show_alert({ message: res.message || __("Completed"), indicator });
							if (res.status === "success") {
								d.hide();
								listview.refresh();
							}
						},
						error() {
							d.enable_primary_action();
						},
					});
				},
			});
			d.show();
		});
	},
});
