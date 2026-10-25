import re

from mcp_login_oauth.pages import LoginField, dead_end_page, login_page

FIELDS = [LoginField("email", "Email", type="email", required=True),
          LoginField("one_time_password", "2FA code", autocomplete="one-time-code", inputmode="numeric")]


def page(**kw):
    args = dict(service_name="InvoiceNinja", fields=FIELDS, pending_id="p1", client_name="claude.ai",
                redirect_host="claude.ai")
    return login_page(**{**args, **kw})


def inputs(html: str) -> list[str]:
    return re.findall(r"<input [^>]*>", html)


def test_fields_render_in_order_with_attributes():
    found = [i for i in inputs(page().body.decode()) if 'type="hidden"' not in i]
    assert len(found) == 2
    assert 'name="email"' in found[0] and 'type="email"' in found[0] and "required" in found[0]
    assert "autofocus" in found[0] and "autofocus" not in found[1]
    assert 'name="one_time_password"' in found[1] and 'autocomplete="one-time-code"' in found[1]
    assert 'inputmode="numeric"' in found[1] and "required" not in found[1] and 'type="text"' in found[1]


def test_everything_user_supplied_is_escaped():
    html = page(client_name="<script>x</script>", error="<b>bad</b>", pending_id='a"b').body.decode()
    assert "<script>x" not in html and "&lt;script&gt;x" in html
    assert "<b>bad</b>" not in html and "&lt;b&gt;bad" in html
    assert 'value="a&quot;b"' in html


def test_pages_cannot_be_framed():
    assert page().headers["x-frame-options"] == "DENY"
    assert dead_end_page("InvoiceNinja", "Gone", "Link expired.", 400).headers["x-frame-options"] == "DENY"


def test_page_names_the_service_and_redirect_host():
    html = page(redirect_host="example.org").body.decode()
    assert "claude.ai</b> wants access to your InvoiceNinja" in html and "example.org" in html
    assert "<title>InvoiceNinja login</title>" in html


def test_error_and_status():
    r = page(error="Wrong password.", status=401)
    assert r.status_code == 401 and "Wrong password." in r.body.decode()
    dead = dead_end_page("X", "Login link expired", "Links work once.", 400)
    assert dead.status_code == 400 and "Reconnect" in dead.body.decode()


def test_hint_and_group_render_as_a_collapsed_section():
    fields = [LoginField("username", "Username"),
              LoginField("token", "API token", type="password", group="Signed in through single sign-on?",
                         hint="Paste the API token <from My Profile>.")]
    html = page(fields=fields).body.decode()
    details = html[html.index("<details>"):html.index("</details>")]
    assert "<summary>Signed in through single sign-on?</summary>" in details
    assert 'name="token"' in details and 'name="username"' not in details
    assert "Paste the API token &lt;from My Profile&gt;." in details
    assert html.index('name="username"') < html.index("<details>") < html.index("<button>")


def test_fields_of_one_group_share_one_section():
    fields = [LoginField("a", "A", group="More"), LoginField("b", "B"), LoginField("c", "C", group="More")]
    html = page(fields=fields).body.decode()
    assert html.count("<details>") == 1
    assert html.index('name="b"') < html.index("<details>") < html.index('name="a"') < html.index('name="c"')
