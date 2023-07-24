odoo.define("pos_cancel_reason.ProductScreen", function (require) {
    "use strict";

    const ProductScreen = require("point_of_sale.ProductScreen");
    const Registries = require("point_of_sale.Registries");
    const NumberBuffer = require("point_of_sale.NumberBuffer");

    const PosProductScreen = (ProductScreen) =>
        class extends ProductScreen {
            async _setValue(val) {
                const employee = this.env.pos.get_cashier();

                if (employee.role === "manager") {
                    await this.showCancelReasonPopup(val);
                } else {
                    await this.askManagerPermissionToCcancel(val);
                }
            }

            async askManagerPermissionToCcancel(val) {
                const numpad_buffer = NumberBuffer.get();
                const {confirmed, payload: inputPin} = await this.showPopup(
                    "NumberPopup",
                    {
                        isPassword: true,
                        title: this.env._t("Password ?"),
                        startingValue: null,
                    }
                );

                if (!confirmed) return false;

                const managers = this.env.pos.employees.filter(
                    (employee) => employee.pin && employee.role == "manager"
                );
                let permission = false;

                for (const i in managers) {
                    // eslint-disable-next-line
                    if (managers[i].pin == Sha1.hash(inputPin)) {
                        permission = true;
                        break;
                    }
                }

                if (permission) {
                    // In the case of using access permission for functionalities
                    // that also involve the use of NumberBuffer,
                    // it is possible that there is a buffer conflict.
                    const currentOrder = this.env.pos.get_order();
                    if (currentOrder && currentOrder.get_selected_orderline()) {
                        const orderline = currentOrder.get_selected_orderline();
                        if (numpad_buffer == "" && orderline.quantity !== 0) {
                            NumberBuffer.reset();
                        }
                    }

                    await this.showCancelReasonPopup(val);
                } else {
                    await this.showPopup("ErrorPopup", {
                        title: this.env._t("Incorrect Password"),
                    });
                }
            }

            async showCancelReasonPopup(val) {
                if (this.state.numpadMode === "quantity") {
                    // Avoids the need to double click to remove an orderline
                    if (val === "" && this.env.pos.config.iface_cancel_immediately) {
                        arguments[0] = "remove";
                    }

                    const selectedOrderline = this.currentOrder.get_selected_orderline();

                    let val_parsed = 0;
                    if (parseFloat(val)) {
                        val_parsed = parseFloat(val);
                    }

                    if (this.env.pos.config.reason_to_cancel) {
                        const compared_qty = selectedOrderline
                            ? val_parsed <= selectedOrderline.quantity
                            : false;
                        // TODO: Use delayed time for not ask for password
                        if (compared_qty) {
                            const {
                                confirmed,
                                payload: selectedOption,
                            } = await this.showPopup("SelectionPopup", {
                                title: this.env._t(
                                    "What is the reason for cancel these lines?"
                                ),
                                list: this.getCancelReasonList(),
                            });

                            if (!confirmed) {
                                return;
                            }

                            const difference = selectedOrderline.quantity - val_parsed;
                            this.env.pos
                                .get_order()
                                .save_cancelled_orderlines_info(
                                    selectedOrderline,
                                    difference,
                                    selectedOption
                                );
                        }
                    }
                }

                super._setValue(...arguments);
            }

            getCancelReasonList() {
                return _.map(this.env.pos.cancel_reasons, (reason) => {
                    return {
                        id: reason.id,
                        label: reason.name,
                        item: reason,
                    };
                });
            }
        };

    Registries.Component.extend(ProductScreen, PosProductScreen);

    return ProductScreen;
});