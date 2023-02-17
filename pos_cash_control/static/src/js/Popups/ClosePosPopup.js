odoo.define("pos_cash_control.ClosePosPopup", function (require) {
    "use strict";

    const {useState, useRef} = owl.hooks;
    const AbstractAwaitablePopup = require("point_of_sale.AbstractAwaitablePopup");
    const Registries = require("point_of_sale.Registries");
    const round_decimals = require("web.utils").round_decimals;

    /**
     * This popup needs to be self-dependent because it needs to be called from different place.
     */
    class ClosePosPopup extends AbstractAwaitablePopup {
        constructor() {
            super(...arguments);
            this.manualInputCashCount = false;
            this.moneyDetailsRef = useRef("moneyDetails");
            this.closeSessionClicked = false;
            this.moneyDetails = null;
            Object.assign(this, this.props.info);
            this.state = useState({});
            Object.assign(this.state, this.props.info.state);
        }
        /**
         * @deprecated Don't remove. There might be overrides.
         */
        // eslint-disable-next-line no-empty-function
        async willStart() {}
        /*
         * Since this popup need to be self dependent, in case of an error, the popup need to be closed on its own.
         */
        mounted() {
            if (this.error) {
                this.cancel();
                if (
                    this.error.message &&
                    [100, 200, 404, -32098].includes(this.error.message.code)
                ) {
                    this.showPopup("ErrorPopup", {
                        title: this.env._t("Network Error"),
                        body: this.env._t(
                            "Please check your internet connection and try again."
                        ),
                    });
                } else {
                    throw this.error;
                }
            }
        }
        openDetailsPopup() {
            if (this.moneyDetailsRef.comp.isClosed()) {
                this.moneyDetailsRef.comp.openPopup();
                this.state.payments[this.defaultCashDetails.id].counted = 0;
                this.state.payments[this.defaultCashDetails.id].difference = -this
                    .defaultCashDetails.amount;
                this.state.notes = "";
                if (this.manualInputCashCount) {
                    this.moneyDetailsRef.comp.reset();
                }
            }
        }
        handleInputChange(paymentId) {
            // eslint-disable-next-line init-declarations
            let expectedAmount;
            if (paymentId === this.defaultCashDetails.id) {
                this.manualInputCashCount = true;
                this.state.notes = "";
                expectedAmount = this.defaultCashDetails.amount;
            } else {
                expectedAmount = this.otherPaymentMethods.find(
                    (pm) => paymentId === pm.id
                ).amount;
            }
            this.state.payments[paymentId].difference = round_decimals(
                this.state.payments[paymentId].counted - expectedAmount,
                this.env.pos.currency.decimals
            );
            this.state.acceptClosing = false;
        }
        updateCountedCash(event) {
            const {total, moneyDetailsNotes, moneyDetails} = event.detail;
            this.state.payments[this.defaultCashDetails.id].counted = total;
            this.state.payments[this.defaultCashDetails.id].difference = round_decimals(
                this.state.payments[[this.defaultCashDetails.id]].counted -
                    this.defaultCashDetails.amount,
                this.env.pos.currency.decimals
            );
            if (moneyDetailsNotes) {
                this.state.notes = moneyDetailsNotes;
            }
            this.manualInputCashCount = false;
            this.moneyDetails = moneyDetails;
            this.state.acceptClosing = false;
        }
        hasDifference() {
            return Object.entries(this.state.payments).find(
                (pm) => pm[1].difference !== 0
            );
        }
        hasUserAuthority() {
            const absDifferences = Object.entries(this.state.payments).map((pm) =>
                Math.abs(pm[1].difference)
            );
            return (
                this.isManager ||
                this.amountAuthorizedDiff === null ||
                Math.max(...absDifferences) <= this.amountAuthorizedDiff
            );
        }
        canCloseSession() {
            return (
                !this.cashControl || !this.hasDifference() || this.state.acceptClosing
            );
        }
        canCancel() {
            return true;
        }
        cancelPopup() {
            if (this.canCancel()) {
                this.cancel();
            }
        }
        closePos() {
            this.trigger("close-pos");
        }
        checkUnpaidOrders() {
            let existsUnpaidOrders = false;
            const unpaidOrders = this.env.pos.db.get_unpaid_orders();
            for (const order_index in unpaidOrders) {
                if (unpaidOrders[order_index].statement_ids.length > 0) {
                    existsUnpaidOrders = true;
                    break;
                }
            }

            return existsUnpaidOrders;
        }
        async closeSession() {
            let existsUnpaidOrders = this.checkUnpaidOrders();
            if (existsUnpaidOrders) {
                await this.showPopup("ErrorPopup", {
                    title: this.env._t("Closing session error"),
                    body: this.env._t(
                        "Exists orders at payment state! Finish it or cancel these orders."
                    ),
                });
                return;
            }
            if (this.canCloseSession() && !this.closeSessionClicked) {
                this.closeSessionClicked = true;
                // eslint-disable-next-line init-declarations
                let response;
                if (this.cashControl) {
                    response = await this.rpc({
                        model: "pos.session",
                        method: "post_closing_cash_details",
                        args: [this.env.pos.pos_session.id],
                        kwargs: {
                            counted_cash: this.state.payments[
                                this.defaultCashDetails.id
                            ].counted,
                        },
                    });
                    if (!response.successful) {
                        return this.handleClosingError(response);
                    }
                }
                await this.rpc({
                    model: "pos.session",
                    method: "update_closing_control_state_session",
                    args: [this.env.pos.pos_session.id, this.state.notes],
                });
                try {
                    const bankPaymentMethodDiffPairs = this.otherPaymentMethods
                        .filter((pm) => pm.is_cash_count)
                        .map((pm) => [pm.id, this.state.payments[pm.id].difference]);
                    response = await this.rpc({
                        model: "pos.session",
                        method: "close_session_from_ui",
                        args: [this.env.pos.pos_session.id, bankPaymentMethodDiffPairs],
                    });
                    if (!response.successful) {
                        return this.handleClosingError(response);
                    }
                    window.location =
                        "/web#action=point_of_sale.action_client_pos_menu";
                } catch (error) {
                    if (
                        error.message &&
                        [100, 200, 404, -32098].includes(error.message.code)
                    ) {
                        await this.showPopup("ErrorPopup", {
                            title: this.env._t("Network Error"),
                            body: this.env._t("Cannot close the session when offline."),
                        });
                    } else {
                        await this.showPopup("ErrorPopup", {
                            title: this.env._t("Closing session error"),
                            body: this.env._t(
                                "An error has occurred when trying to close the session.\n" +
                                    "You will be redirected to the back-end to manually close the session."
                            ),
                        });
                        window.location =
                            "/web#action=point_of_sale.action_client_pos_menu";
                    }
                }
                this.closeSessionClicked = false;
            }
        }
        async handleClosingError(response) {
            await this.showPopup("ErrorPopup", {
                title: "Error",
                body: response.message,
            });
            if (response.redirect) {
                window.location = "/web#action=point_of_sale.action_client_pos_menu";
            }
        }
        _getShowDiff(pm) {
            return pm.is_cash_count && pm.number !== 0;
        }
    }

    ClosePosPopup.template = "ClosePosPopup";
    Registries.Component.add(ClosePosPopup);

    return ClosePosPopup;
});
