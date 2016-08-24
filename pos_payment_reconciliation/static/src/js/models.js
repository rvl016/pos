/*****************************************************************************
* © 2016 KMEE INFORMATICA LTDA (<http://kmee.com.br>)
*    Hendrix Costa <hendrix.costa@kmee.com.br>
*    Luiz Felipe do Divino <luiz.divino@kmee.com.br>
* License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl.html).
******************************************************************************/

function pos_payment_reconciliation_models(instance, module){

    module.Paymentline = module.Paymentline.extend({
        set_payment_authorization: function(payment_authorization){
            this.payment_term = payment_authorization;
        },
        get_payment_authorization: function(){
            return this.payment_term;
        },
        set_payment_doc: function(payment_doc){
            this.payment_doc = payment_doc;
        },
        get_payment_doc: function(){
            return this.payment_doc;
        },
        export_as_JSON: function(){
            var result = module.Paymentline.prototype.__proto__.export_as_JSON.call(this);
            // result['note'] = this.get_payment_doc() + '/' + this.get_payment_authorization();
            result['note'] = 'teste/testeDOC';
            return result;
        }
    });
}