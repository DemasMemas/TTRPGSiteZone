from app.extensions import db
from app.models import User


def test_registration_login_and_profile_round_trip(client, create_user, auth_headers):
    user = create_user("stalker")

    response = client.get("/auth/profile", headers=auth_headers(user))

    assert response.status_code == 200
    assert response.get_json() == {
        "id": user["id"],
        "username": "stalker",
        "email": "stalker@example.com",
    }


def test_protected_profile_rejects_anonymous_request(client):
    response = client.get("/auth/profile")

    assert response.status_code == 401


def test_login_rejects_wrong_password(client, create_user):
    create_user("wrong-password")

    response = client.post(
        "/auth/login",
        json={"username": "wrong-password", "password": "not-the-password"},
    )

    assert response.status_code == 401
    assert response.get_json()["error"] == "Invalid credentials"


def test_duplicate_username_is_rejected(client, create_user):
    create_user("duplicate")

    response = client.post(
        "/auth/register",
        json={
            "username": "duplicate",
            "email": "another@example.com",
            "password": "secret-123",
        },
    )

    assert response.status_code == 400


def test_registration_validates_email_and_password(client):
    response = client.post(
        "/auth/register",
        json={
            "username": "valid-name",
            "email": "not-an-email",
            "password": "short",
        },
    )

    assert response.status_code == 400


def test_user_color_requires_hex_format(client, create_user, auth_headers):
    user = create_user("color-user")

    invalid = client.patch(
        "/auth/color",
        headers=auth_headers(user),
        json={"color": "green"},
    )
    valid = client.patch(
        "/auth/color",
        headers=auth_headers(user),
        json={"color": "#4A7C59"},
    )

    assert invalid.status_code == 400
    assert valid.status_code == 200
    assert valid.get_json()["color"] == "#4A7C59"
    db.session.expire_all()
    assert db.session.get(User, user["id"]).color == "#4A7C59"
