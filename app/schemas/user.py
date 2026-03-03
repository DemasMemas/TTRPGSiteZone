# app/schemas/user.py
from marshmallow import Schema, fields, validate, validates, ValidationError
from app.models import User

class UserSchema(Schema):
    id = fields.Int(dump_only=True)
    username = fields.Str(required=True, validate=validate.Length(min=3, max=80))
    email = fields.Email(required=True)
    password = fields.Str(load_only=True, required=True, validate=validate.Length(min=6))

    @validates('username')
    def validate_username(self, value, **kwargs):
        if User.query.filter_by(username=value).first():
            raise ValidationError('Username already exists')
        return value

    @validates('email')
    def validate_email(self, value, **kwargs):
        if User.query.filter_by(email=value).first():
            raise ValidationError('Email already exists')
        return value

class UserLoginSchema(Schema):
    username = fields.Str(required=True)
    password = fields.Str(required=True, load_only=True)

class UserProfileSchema(Schema):
    id = fields.Int()
    username = fields.Str()
    email = fields.Email()