odoo.define('pos_barcode_tare.screens', function (require) {

    "use strict";
    var chrome = require('point_of_sale.chrome');
    var core = require('web.core');
    var devices = require('point_of_sale.devices');
    var gui = require('point_of_sale.gui');
    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');
    var utils = require('web.utils');
    var formats = require('web.formats');

    var QWeb = core.qweb;
    var _t = core._t;
    var round_pr = utils.round_precision;
    var round_di = utils.round_decimals;
    var tare_barcode_type = "tare";

    // Define functions used to do unit operation.
    // Get unit search for unit based on unit name.
    var get_unit = function (pos, unit_name) {
        return pos.units.filter(
            function (u) {
                return u.name === unit_name;
            })[0];
    };

    // Convert mass using the reference UOM as pivot unit.
    var convert_mass = function (mass, from_unit, to_unit) {
        // There is no conversion from one category to another.
        if (from_unit.category_id[0] !== to_unit.category_id[0]) {
            throw new Error(_.str.sprintf(
                _t("We can not cast a weight in %s into %s."),
                from_unit.name, to_unit.name));
        }
        // No need to convert as weights are measured in same unit.
        if (from_unit.id === to_unit.id) {
            return mass;
        }
        // Converts "from_unit" to reference unit of measure.
        var result = mass;
        if (from_unit.uom_type === "bigger") {
            result /= from_unit.factor;
        } else {
            result *= from_unit.factor_inv;
        }
        // Converts reference unit of measure to "to_unit".
        if (to_unit.uom_type === "bigger") {
            result *= to_unit.factor;
        } else {
            result /= to_unit.factor_inv;
        }

        if (to_unit.rounding) {
            // Return the rounded result if needed.
            return round_pr(result || 0, to_unit.rounding);
        }

        return result || 0;
    };

    // This configures read action for tare barcode. A tare barcode contains a
    // fake product ID and the weight to be subtracted from the product in the
    // latest order line.
    screens.ScreenWidget.include(
        {
            barcode_tare_action: function (code) {
                try {
                    var order = this.pos.get_order();
                    var last_order_line = order.get_last_orderline();
                    var tare_weight = code.value;
                    last_order_line.set_tare(tare_weight);
                } catch (error) {
                    var title = _t("We can not apply this tare barcode.");
                    var popup = {title: title, body: error.message};
                    this.gui.show_popup('error', popup);
                }
            },
            // Setup the callback action for the "weight" barcodes.
            show: function () {
                this._super();
                this.pos.barcode_reader.set_action_callback(
                    'tare',
                    _.bind(this.barcode_tare_action, this));
            },
        });

    // This create a new button on top of action widget. This button links to
    // the barcode label printing screen defined below.
    var TareScreenButton = screens.ActionButtonWidget.extend({
        template: 'TareScreenButton',

        button_click: function () {
            this.gui.show_screen('tare');
        },
    });

    screens.define_action_button({
        'name': 'tareScreenButton',
        'widget': TareScreenButton,
    });

    // This is a new screen that reads weight from the electronic scale and
    // create a barcode label encoding the weight. The screen shows a preview
    // of the label. The user is expected to check if the preview matches what's
    // measured on the scale. The barcode image is generated by the report
    // module.
    var TareScreenWidget = screens.ScreenWidget.extend({
        template: 'TareScreenWidget',
        next_screen: 'products',
        previous_screen: 'products',
        default_tare_value: 0.0,
        weight_barcode_prefix: null,

        show: function () {
            this._super();
            // Fetch the unit of measure used to save the tare
            this.kg_unit = get_unit(this.pos, "kg");
            // Fetch the barcode prefix from POS barcode parser rules.
            this.weight_barcode_prefix = this.get_barcode_prefix();
            // Setup the proxy
            var queue = this.pos.proxy_queue;
            // The pooling of the scale starts here.
            var self = this;
            queue.schedule(function () {
                return self.pos.proxy.scale_read().then(function (weight) {
                    try {
                        self.set_weight(weight);
                    } catch (error) {
                        var title = _t("Failed to read weight from scale.");
                        var popup = {title: title, body: error.message};
                        self.gui.show_popup('error', popup);
                    }
                });
            }, {duration:150, repeat: true});
            // Shows a barcode whose weight might be zero, but this is preferred
            // for UI/UX reasons.
            this.render_receipt();
            this.lock_screen(true);
        },
        get_barcode_prefix: function () {
            var barcode_pattern = this.get_barcode_pattern();
            return barcode_pattern.substr(0, 2);
        },
        get_barcode_pattern: function () {
            var rules = this.get_barcode_rules();
            var rule = rules.filter(
                function (r) {
                    // We select the first (smallest sequence ID) barcode rule
                    // with the expected type.
                    return r.type === tare_barcode_type;
                })[0];
            return rule.pattern;
        },
        get_barcode_rules: function () {
            return this.pos.barcode_reader.barcode_parser.nomenclature.rules;
        },
        set_weight: function (scale_measure) {
            var weight = scale_measure.weight;
            var unit = get_unit(this.pos, scale_measure.unit);

            if (typeof unit === 'undefined') {
                throw new Error(_.str.sprintf(
                    _t("The scale sent a measure in %s unit. This unit of "+
                     "measure (UOM) in not found in the point of sale. You " +
                     "may need to create a new UOM named %s. The UOM name is "+
                     "case sensitive."), scale_measure.unit,
                    scale_measure.unit));
            }

            if (weight > 0) {
                this.weight_in_kg = convert_mass(weight, unit, this.kg_unit);
                this.render_receipt();
                this.lock_screen(false);
            }
        },
        get_weight: function () {
            if (typeof this.weight_in_kg === 'undefined') {
                return this.default_tare_value;
            }
            return this.weight_in_kg;
        },
        barcode_data: function (weight) {
            // We use EAN13 barcode, it looks like 07 00000 12345 x. First there
            // is the prefix, here 07, that is used to decide which type of
            // barcode we're dealing with. A weight barcode has then two groups
            // of five digits. The first group encodes the product id. Here the
            // product id is 00000. The second group encodes the weight in
            // grams. Here the weight is 12.345kg. The last digit of the barcode
            // is a checksum, here symbolized by x.
            var padding_size = 5;
            var void_product_id = '0'.repeat(padding_size);
            var weight_in_gram = weight * 1e3;

            if (weight_in_gram >= Math.pow(10, padding_size)) {
                throw new RangeError(_t("Maximum tare weight is 99.999kg"));
            }

            // Weight has to be padded with zeros.
            var weight_with_padding = '0'.repeat(padding_size) + weight_in_gram;
            var padded_weight = weight_with_padding.substr(
                weight_with_padding.length - padding_size);
            // Builds the barcode using a placeholder checksum.
            var barcode = this.weight_barcode_prefix
                .concat(void_product_id, padded_weight)
                .concat(0);
            // Compute checksum
            var barcode_parser = this.pos.barcode_reader.barcode_parser;
            var checksum = barcode_parser.ean_checksum(barcode);
            // Replace checksum placeholder by the actual checksum.
            return barcode.substr(0, 12).concat(checksum);
        },
        get_barcode_data: function () {
            return this.barcode_data(this.get_weight());
        },
        lock_screen: function (locked) {
            this._locked = locked;
            if (locked) {
                this.$('.print-label').addClass('disabled');
            } else {
                this.$('.print-label').removeClass('disabled');
            }
        },
        print_web: function () {
            window.print();
            this.pos.get_order()._printed = true;
        },
        print: function () {
            // See comment in print function of ReceiptScreenWidget
            this.lock_screen(true);
            var self = this;
            setTimeout(function () {
                self.lock_screen(false);
            }, 1000);

            this.print_web();
            this.click_back();
        },
        click_back: function () {
            this.close();
            this.gui.show_screen(this.previous_screen);
        },
        renderElement: function () {
            this._super();
            var self = this;
            this.$('.back').click(function () {
                self.click_back();
            });
            this.$('.print-label').click(function () {
                if (!self._locked) {
                    self.print();
                }
            });
        },
        render_receipt: function () {
            this.$('.pos-tare-label-container').html(
                QWeb.render('PosTareLabel', {widget:this}));
        },
        close: function () {
            this._super();
            delete this.weight;
            this.pos.proxy_queue.clear();
        },
    });

    gui.define_screen({name:'tare', widget: TareScreenWidget});

    // Update Orderline model
    var _super_ = models.Orderline.prototype;

    models.Orderline = models.Orderline.extend({
        initialize: function (session, attributes) {
            this.tareQuantity = 0;
            this.tareQuantityStr = '0';
            return _super_.initialize.call(this, session, attributes);
        },
        init_from_JSON: function (json) {
            _super_.init_from_JSON.call(this, json);
            this.tareQuantity = json.tareQuantity ||0;
            this.tareQuantityStr = json.tareQuantityStr ||'0';
        },
        set_tare: function (quantity) {
            this.order.assert_editable();

            // Prevent to apply multiple times a tare to the same product.
            if (this.get_tare() > 0) {
                throw new RangeError(_.str.sprintf(
                    _t("The tare (%s) is already set for the " +
                    "product \"%s\". We can not re-apply a tare to this " +
                    "product."),
                    this.get_tare_str_with_unit(), this.product.display_name));
            }

            var self = this;
            // This function is used to format the quantity into string
            // according to the rounding specifications.
            var stringify = function (qty) {
                var unit = self.get_unit();
                if (unit.rounding) {
                    var q = round_pr(qty, unit.rounding);
                    var decimals = self.pos.dp['Product Unit of Measure'];
                    return formats.format_value(
                        round_di(q, decimals),
                        {type: 'float', digits: [69, decimals]});
                }
                return qty.toFixed(0);
            };
            // We convert the tare that is always measured in kilogrammes into
            // the unit of measure for this order line.
            var kg = get_unit(this.pos, "kg");
            var tare = parseFloat(quantity) || 0;
            var unit = this.get_unit();
            var tare_in_product_uom = convert_mass(tare, kg, unit);
            var tare_in_product_uom_string = stringify(tare_in_product_uom);
            var net_quantity = this.get_quantity() - tare_in_product_uom;
            // This method fails when the net weight is negative.
            if (net_quantity <= 0) {
                throw new RangeError(_.str.sprintf(
                    _t("The tare weight is %s %s, it's greater or equal to " +
                    "the product weight %s. We can not apply this tare."),
                    tare_in_product_uom_string, unit.name,
                    this.get_quantity_str_with_unit()));
            }
            // Update tare value.
            this.tareQuantity = tare_in_product_uom;
            this.tareQuantityStr = tare_in_product_uom_string;
            // Update the quantity with the new weight net of tare quantity.
            this.set_quantity(net_quantity);
            this.trigger('change', this);
        },
        get_tare: function () {
            return this.tareQuantity;
        },
        get_tare_str: function () {
            return this.tareQuantityStr;
        },
        get_tare_str_with_unit: function () {
            var unit = this.get_unit();
            return this.tareQuantityStr + ' ' + unit.name;
        },
        export_as_JSON: function () {
            var json = _super_.export_as_JSON.call(this);
            json.tareQuantity = this.get_tare();
            json.tareQuantityStr = this.get_tare_str();
            return json;
        },
        clone: function () {
            var orderline = _super_.clone.call(this);
            orderline.tareQuantity = this.tareQuantity;
            orderline.tareQuantityStr = this.tareQuantityStr;
            return orderline;
        },
        export_for_printing: function () {
            var result = _super_.export_for_printing.call(this);
            result.tare_quantity = this.get_tare();
            return result;
        },
    });
});
