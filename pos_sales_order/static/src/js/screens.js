odoo.define("pos_sale_backport.screens", function (require) {
    "use strict";

    const screens = require("point_of_sale.screens");
    const gui = require("point_of_sale.gui");
    const models = require("point_of_sale.models");

    const rpc = require("web.rpc");

    const SaleOrderManagementScreen = screens.ScreenWidget.extend({
        template: "SaleOrderManagementScreen",
        events: {
            "click .click-sale-order": "_onClickSaleOrder",
        },

        init: function (parent, options) {
            this._super(parent, options);

            this.currentPage = 1;
            this.ordersToShow = [];
            this.totalCount = 0;
        },

        show: async function () {
            this._super();
            await this._mount();
            setTimeout(() => this.renderElement(), 100);
        },

        renderElement: function () {
            this._super();
            this.$(".close-screen").click(() => {
                this.pos.gui.back();
            });

            this.$(".search-order").change(() => {
                const inputElement =
                    document.getElementById("search-order-input");
                const inputValue = inputElement.value;

                if (inputValue) {
                    let temp = [];
                    for (let i = 0; i < this.ordersToShow.length; i++) {
                        let textValue = this.ordersToShow[i].name;
                        if (
                            textValue
                                .toUpperCase()
                                .indexOf(inputValue.toUpperCase()) > -1
                        ) {
                            temp.push(this.ordersToShow[i]);
                        }
                    }
                    this.ordersToShow = temp;
                    this.renderElement();
                }
            });

            this.$(".refresh").click(async () => {
                await this._mount();
                setTimeout(() => this.renderElement(), 100);
            });
        },

        /* GENERIC FUNCTIONS FOR SCREEN */

        setNPerPage: function (value) {
            this.nPerPage = value;
        },

        fetch: async function () {
            try {
                let limit, offset;
                offset =
                    this.nPerPage + (this.currentPage - 1 - 1) * this.nPerPage;
                limit = this.nPerPage;
                this.ordersToShow = await this._fetch(limit, offset);
            } catch (error) {
                if (error.message === "XmlHttpRequestError ") {
                    this.pos.gui.show_popup("error", {
                        title: _t("Network Error"),
                        body: _t("Unable to fetch orders if offline."),
                    });
                } else {
                    throw error;
                }
            }
        },

        _fetch: async function (limit, offset) {
            const saleOrders = await this._getSaleOrderForCurrentPage(
                limit,
                offset
            );
            this.totalCount = saleOrders.length;
            return saleOrders;
        },

        _mount: function () {
            /*
             ! This is not working for now and apply a bug that's not render
             !  the list properly.
             */
            // const flexContainer = this.el.querySelector(".flex-container");
            // const controlPanel = this.el.querySelector(".control-panel");
            // const header = this.el.querySelector(".header-row");
            // const rowLimit = Math.trunc(
            //     (flexContainer.offsetHeight - controlPanel.offsetHeight - header.offsetHeight) /
            //     header.offsetHeight
            // );

            // this.setNPerPage(rowLimit);
            this.fetch();
        },

        _getSaleOrderForCurrentPage: async function (limit, offset) {
            let domain = [["currency_id", "=", this.pos.currency.id]].concat(
                this.searchDomain || []
            );
            return await rpc.query({
                model: "sale.order",
                method: "search_read",
                args: [
                    domain,
                    [
                        "name",
                        "partner_id",
                        "amount_total",
                        "date_order",
                        "state",
                        "user_id",
                    ],
                    limit,
                    offset,
                ],
            });
        },

        /* FUNCTIONS TO IMPORT THE SALE ORDER IN POS */

        _onClickSaleOrder: async function (event) {
            let rowLineID;
            if ($(event.target.parentNode).hasClass("click-sale-order")) {
                rowLineID = parseInt(
                    $(event.target.parentNode).data("item-index")
                );
            } else {
                rowLineID = parseInt(
                    $(event.target.parentNode.parentNode).data("item-index")
                );
            }
            if (rowLineID || rowLineID === 0) {
                const selectedOrder = this.ordersToShow[rowLineID];
                await this.pos.gui.show_popup("selection", {
                    title: _t("What do you want to do?"),
                    list: [
                        {
                            id: "0",
                            label: _t("Apply a down payment"),
                            item: false,
                        },
                        { id: "1", label: _t("Settle the order"), item: true },
                    ],
                    confirm: (selectedItem) => {
                        this._importSaleOrder(selectedOrder, selectedItem);
                    },
                });
            } else {
                await this.pos.gui.show_popup("error", {
                    title: _t("Error when selecting sales order"),
                    body: _t(
                        "There was an error selecting this order, please try again."
                    ),
                });
            }
        },

        _importSaleOrder: async function (selectedOrder, selectedOption) {
            let currentPOSOrder = this.pos.get_order();
            let saleOrder = await this._getSaleOrder(selectedOrder.id);
            try {
                await this.load_new_partners();
            } catch (error) {}
            let orderPartner = this.pos.db.get_partner_by_id(
                saleOrder.partner_id[0]
            );
            if (orderPartner) {
                currentPOSOrder.set_client(orderPartner);
            } else {
                try {
                    await this._loadPartners([saleOrder.partner_id[0]]);
                } catch (error) {
                    this.pos.gui.show_popup("error", {
                        title: _t("Customer loading error"),
                        body: _.str.sprintf(
                            _t(
                                "There was a problem in loading the %s costumer."
                            ),
                            saleOrder.partner_id[1]
                        ),
                    });
                }
                currentPOSOrder.set_client(
                    this.pos.db.get_partner_by_id(saleOrder.partner_id[0])
                );
            }

            let orderFiscalPos = saleOrder.fiscal_position_id
                ? this.pos.fiscal_positions.find(
                      (position) =>
                          position.id === saleOrder.fiscal_position_id[0]
                  )
                : false;
            if (orderFiscalPos) {
                currentPOSOrder.fiscal_position = orderFiscalPos;
            }
            let orderPricelist = saleOrder.pricelist_id
                ? this.pos.pricelists.find(
                      (pricelist) => pricelist.id === saleOrder.pricelist_id[0]
                  )
                : false;
            if (orderPricelist) {
                currentPOSOrder.set_pricelist(orderPricelist);
            }

            if (selectedOption) {
                let lines = saleOrder.order_line;
                let product_to_add_in_pos = lines
                    .filter(
                        (line) =>
                            !this.pos.db.get_product_by_id(line.product_id[0])
                    )
                    .map((line) => line.product_id[0]);
                if (product_to_add_in_pos.length) {
                    // await this.pos.gui.show_popup("confirm", {
                    //     title: _t("Products not available in POS"),
                    //     body: _t("Some of the products in your Sale Order are not available in POS, do you want to import them?"),
                    //     confirm: () => {
                    //         this._addProducts(product_to_add_in_pos);
                    //     }
                    // });
                    /*
                     
                     * In the original version of the code, this import process will
                     * only happen after user confirmation. However, for now whenever
                     * a product is not available in the POS, it will be imported
                     * automatically.
                      
                     TODO: Use a Promise or Deferred object. 
                     */
                    await this._addProducts(product_to_add_in_pos);
                }

                /*
                 * This variable will have 3 values, 'undefined | false | true'.
                 * Initially, it is `undefined`. When looping thru each sale.order.line,
                 * when a line comes with lots (`.lot_names`), we use these lot names
                 * as the pack lot of the generated pos.order.line. We ask the user
                 * if he wants to use the lots that come with the sale.order.lines to
                 * be used on the corresponding pos.order.line only once. So, once the
                 * `useLoadedLots` becomes true, it will be true for the succeeding lines,
                 * and vice versa.
                 */
                let useLoadedLots;

                for (let i = 0; i < lines.length; i++) {
                    let line = lines[i];
                    if (!this.pos.db.get_product_by_id(line.product_id[0])) {
                        continue;
                    }
                    let newLine = new models.Orderline(
                        {},
                        {
                            pos: this.pos,
                            order: this.pos.get_order(),
                            product: this.pos.db.get_product_by_id(
                                line.product_id[0]
                            ),
                            description: line.name,
                            price: line.price_unit,
                            tax_ids: orderFiscalPos ? undefined : line.tax_id,
                            price_manually_set: true,
                            sale_order_origin_id: selectedOrder.id,
                            sale_order_line_id: line,
                            note: line.customer_note,
                        }
                    );

                    if (
                        newLine.get_product().tracking !== "none" &&
                        (this.pos.picking_type.use_create_lots ||
                            this.pos.picking_type.use_existing_lots) &&
                        line.lot_names.length > 0
                    ) {
                        // Ask once when `useLoadedLots` is undefined, then reuse it's value on the succeeding lines.
                        await this.pos.gui.show_popup("confirm", {
                            title: _t("SN/Lots Loading"),
                            body: _t(
                                "Do you want to load the SN/Lots linked to the Sales Order?"
                            ),
                            confirm: () => {
                                useLoadedLots = true;
                            },
                        });
                        if (useLoadedLots) {
                            newLine.setPackLotLines({
                                modifiedPacklotLines: [],
                                newPackLotLines: (line.lot_names || []).map(
                                    (name) => ({ lot_name: name })
                                ),
                            });
                        }
                    }
                    this.pos.get_order().add_orderline(newLine);
                    newLine.setQuantityFromSOL(line);
                    newLine.set_unit_price(line.price_unit);
                    newLine.set_discount(line.discount);
                }
                this.pos.gui.back();
            } else {
                // apply a downpayment
                if (this.pos.config.down_payment_product_id) {
                    let lines = saleOrder.order_line;
                    let tab = [];
                    for (let i = 0; i < lines.length; i++) {
                        tab[i] = {
                            product_name: lines[i].product_id[1],
                            product_uom_qty: lines[i].product_uom_qty,
                            price_unit: lines[i].price_unit,
                            total: lines[i].price_total,
                        };
                    }
                    let down_payment_product = this.pos.db.get_product_by_id(
                        this.pos.config.down_payment_product_id[0]
                    );
                    let down_payment_tax =
                        this.pos.taxes_by_id[down_payment_product.taxes_id] ||
                        false;
                    let down_payment;
                    if (down_payment_tax) {
                        down_payment = down_payment_tax.price_include
                            ? saleOrder.amount_total
                            : saleOrder.amount_untaxed;
                    } else {
                        down_payment = saleOrder.amount_total;
                    }
                    let percentageValue;
                    await this.pos.gui.show_popup("number", {
                        title: _.str.sprintf(
                            _t("Percetage of %s"),
                            this.format_currency(saleOrder.amount_total)
                        ),
                        value: 0,
                        confirm: (number) => {
                            percentageValue = float(number);
                        },
                    });
                    if (percentageValue) {
                        down_payment =
                            (down_payment * parseFloat(percentageValue)) / 100;
                    }
                    let newLine = new models.Orderline(
                        {},
                        {
                            pos: this.pos,
                            order: this.pos.get_order(),
                            product: down_payment_product,
                            price: down_payment,
                            price_manually_set: true,
                            sale_order_origin_id: selectedOrder.id,
                            down_payment_details: tab,
                        }
                    );
                    newLine.set_unit_price(down_payment);
                    this.pos.get_order().add_orderline(newLine);
                    this.pos.gui.back();
                } else {
                    await this.pos.gui.show_popup("error", {
                        title: _t("No down payment product"),
                        body: _t(
                            "It seems that you didn't configure a down payment product in your point of sale.\
                                 You can go to your point of sale configuration to choose one."
                        ),
                    });
                }
            }
        },

        _getSaleOrder: async function (id) {
            const saleOrder = await rpc.query({
                model: "sale.order",
                method: "read",
                args: [
                    [id],
                    [
                        "order_line",
                        "partner_id",
                        "pricelist_id",
                        "fiscal_position_id",
                        "amount_total",
                        "amount_untaxed",
                    ],
                ],
            });
            const saleLines = await this._getSOLines(saleOrder[0].order_line);
            saleOrder[0].order_line = saleLines;
            return saleOrder[0];
        },

        _getSOLines: async function (ids) {
            return await rpc.query({
                model: "sale.order.line",
                method: "read_converted",
                args: [ids],
            });
        },

        /* POSMODEL 14.0 FUNCTIONS */

        load_new_partners: function () {
            const self = this;
            return new Promise((resolve, reject) => {
                let fields = _.find(self.pos.models, (model) => {
                    return model.label === "load_partners";
                }).fields;
                let domain = self.prepare_new_partners_domain();
                rpc.query(
                    {
                        model: "res.partner",
                        method: "search_read",
                        args: [domain, fields],
                    },
                    {
                        timeout: 3000,
                        shadow: true,
                    }
                ).then(
                    (partners) => {
                        if (self.pos.db.add_partners(partners)) {
                            resolve();
                        } else {
                            reject(new Error("Failed in updating partner."));
                        }
                    },
                    (type, err) => {
                        reject();
                    }
                );
            });
        },

        prepare_new_partners_domain: function () {
            return [["write_date", ">", this.pos.db.get_partner_write_date()]];
        },

        _loadPartners: async function (partnerIds) {
            if (partnerIds.length > 0) {
                let fields = _.find(this.pos.models, function (model) {
                    return model.label === "load_partners";
                }).fields;
                let domain = [["id", "in", partnerIds]];
                const fetchPartners = await rpc.query({
                    model: "res.partner",
                    method: "search_read",
                    args: [domain, fields],
                });
                this.pos.db.add_partners(fetchPartners);
            }
        },

        _addProducts: async function (ids, setAvailable = true) {
            if (setAvailable) {
                await rpc.query({
                    model: "product.product",
                    method: "write",
                    args: [ids, { available_in_pos: true }],
                });
            }
            let productModel = _.find(
                this.pos.models,
                (model) => model.model === "product.product"
            );
            let product = await rpc.query({
                model: "product.product",
                method: "read",
                args: [ids, productModel.fields],
            });
            productModel.loaded(this.pos, product);
        },

        /* ROWS FUNCTIONS IN SALE ORDER MANAGEMENT SCREEN */

        getName: function (order) {
            return order.name;
        },

        getDate: function (order) {
            return moment(order.date_order).format("YYYY-MM-DD hh:mm A");
        },

        getCustomer: function (order) {
            return order.partner_id ? order.partner_id[1] : null;
        },

        getAmountTotal: function (order) {
            return this.format_currency(order.amount_total);
        },

        getSalesman: function (order) {
            return order.user_id ? order.user_id[1] : null;
        },

        getOrderState: function (order) {
            let stateMapping = {
                draft: _t("Quotation"),
                sent: _t("Quotation Sent"),
                sale: _t("Sales Order"),
                done: _t("Locked"),
                cancel: _t("Cancel"),
            };
            return stateMapping[order.state];
        },
    });

    gui.define_screen({
        name: "sale_order",
        widget: SaleOrderManagementScreen,
    });

    const SaleOrderButton = screens.ActionButtonWidget.extend({
        template: "SaleOrderButton",
        button_click: async function () {
            try {
                await rpc.query({
                    model: "sale.order",
                    method: "browse",
                    args: [[]],
                });
                this.pos.gui.show_screen("sale_order");
            } catch (error) {
                if (error.message === "XmlHttpRequestError ") {
                    this.pos.gui.show_popup("error", {
                        title: _t("Network Error"),
                        body: _t(
                            "Cannot access order management screen if offline."
                        ),
                    });
                } else {
                    throw error;
                }
            }
        },
    });

    screens.define_action_button({
        name: "sale_order_button",
        widget: SaleOrderButton,
    });
});
