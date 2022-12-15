# Copyright 2022 KMEE (<http://www.kmee.com.br>)
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl.html).

from odoo import _, fields, models
from odoo.exceptions import ValidationError


class PosConfig(models.Model):
    _inherit = "pos.config"

    reason_to_cancel = fields.Boolean(
        string="Reason to Cancel",
        default=False,
    )
    delay_to_cancel = fields.Integer(
        string="Delayed time to cancel",
        default=10,
    )

    def write(self, vals):
        if vals.get("reason_to_cancel") and vals["reason_to_cancel"]:
            reason_to_cancel_ids = self.env["pos.cancel.reason"].search(
                [("active", "=", True)]
            )
            if not reason_to_cancel_ids:
                raise ValidationError(
                    _(
                        "You can't set reasons to cancel in "
                        "POS without any reason created!"
                    )
                )

        return super(PosConfig, self).write(vals)