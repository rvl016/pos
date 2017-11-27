# -*- coding: utf-8 -*-
##############################################################################
# Point Of Sale - Pricelist for POS Odoo
# Copyright (C) 2015 Taktik (http://www.taktik.be)
# @author Adil Houmadi <ah@taktik.be>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.
#
##############################################################################
from openerp import models, fields, api


class PosPriceListConfig(models.Model):
    _inherit = 'pos.config'

    display_price_with_taxes = fields.Boolean(
        string='Price With Taxes',
        help="Display Prices with taxes on POS"
    )

    referenced_pricelist_ids = fields.One2many(
        string="Referenced Pricelists",
        help=' '.join("""
Pricelistst that are referenced directly by this point of sale or indirectly by
pricelists items in pricelists referenced by this point of sale.
""".strip().split('\n')),
        comodel_name="product.pricelist",
        compute='_referenced_pricelist_ids_compute',
    )

    @api.depends('pricelist_id', 'pricelist_id.version_id',
                 'pricelist_id.version_id.items_id')
    @api.one
    def _referenced_pricelist_ids_compute(self):
        remaining = pricelists = self.pricelist_id
        items = self.env['product.pricelist.item']
        while remaining:
            pricelist = remaining[0]
            remaining -= pricelist
            items = items.search([
                ('price_version_id.active', '=', True),
                ('price_version_id.pricelist_id', '=', pricelist.id),
                ('base_pricelist_id', '!=', None),
            ])
            new_pricelists = (
                items.mapped('base_pricelist_id') - pricelists
            )
            remaining |= new_pricelists
            pricelists |= new_pricelists

        self.referenced_pricelist_ids = pricelists
