odoo.define("pos_cancel_reason.ProductScreen", function (require) {
    "use strict";

    const ProductScreen = require("point_of_sale.ProductScreen");
    const Registries = require("point_of_sale.Registries");

    const PosProductScreen = (ProductScreen) =>
        class extends ProductScreen {
            async _setValue(val) {
                if (this.state.numpadMode === "quantity") {
                    // Avoids the need to double click to remove an orderline with zero quantity
                    const selectedOrderline = this.currentOrder.get_selected_orderline();
                    if (val === "" && selectedOrderline.quantity === 0) {
                        arguments[0] = "remove";
                    }

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
                            const cancel_reason_options = [];
                            for (const i in this.env.pos.cancel_reasons) {
                                cancel_reason_options.push({
                                    id: this.env.pos.cancel_reasons[i].id,
                                    label: this.env.pos.cancel_reasons[i].name,
                                    item: this.env.pos.cancel_reasons[i],
                                });
                            }
                            const {
                                confirmed,
                                payload: selectedOption,
                            } = await this.showPopup("SelectionPopup", {
                                title: this.env._t(
                                    "What is the reason for cancel these lines?"
                                ),
                                list: cancel_reason_options,
                            });
                            if (confirmed) {
                                const difference =
                                    selectedOrderline.quantity - val_parsed;
                                this.env.pos
                                    .get_order()
                                    .save_cancelled_orderlines_info(
                                        difference,
                                        selectedOption
                                    );
                                super._setValue(...arguments);
                            }
                        } else {
                            super._setValue(...arguments);
                        }
                    } else {
                        super._setValue(...arguments);
                    }
                } else {
                    super._setValue(...arguments);
                }
            }
        };
    Registries.Component.extend(ProductScreen, PosProductScreen);

    return ProductScreen;
});
