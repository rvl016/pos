# Copyright 2022 KMEE
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

{
    "name": "Pos Product Control",
    "summary": """
        Allows product inventory control during the opening and closing process
         of a POS session.""",
    "version": "14.0.1.0.0",
    "license": "AGPL-3",
    "author": "KMEE,Odoo Community Association (OCA)",
    "website": "https://github.com/OCA/pos",
    "depends": [
        "pos_cash_control",
    ],
    "data": [
        "security/pos_session_product_control.xml",
        "views/pos_session_product_control.xml",
        "views/pos_session.xml",
        "views/pos_config.xml",
        "views/pos_assets_common.xml",
    ],
    "demo": [],
    "qweb": [
        "static/src/xml/Screens/ProductScreen/CashBoxOpening.xml",
        "static/src/xml/Popups/ClosePosPopup.xml",
    ],
}