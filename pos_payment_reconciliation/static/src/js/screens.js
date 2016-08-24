/*****************************************************************************
* © 2016 KMEE INFORMATICA LTDA (<http://kmee.com.br>)
*    Hendrix Costa <hendrix.costa@kmee.com.br>
*    Luiz Felipe do Divino <luiz.divino@kmee.com.br>
* License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl.html).
******************************************************************************/

function pos_payment_reconciliation_screens(instance, module) {

    module.PaymentScreenWidget = module.PaymentScreenWidget.extend({
        validate_order: function(options) {
            this._super();
            var self = this;

            var currentOrder = this.pos.get('selectedOrder');

            var plines = currentOrder.get('paymentLines').models;
            var payment_authorization_lines = [];
            this.$('.payment-authorization').each(function(){
                payment_authorization_lines.push(this.value);
            });
            var payment_doc_lines = [];
            this.$('.payment-doc').each(function(){
                payment_doc_lines.push(this.value);
            });

            for (var i = 0; i < plines.length; i++) {
                plines[i].set_payment_authorization(payment_authorization_lines[i]);
                plines[i].set_payment_doc(payment_doc_lines[i]);
            }
        }
     });

 }