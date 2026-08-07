"""Sample ontology bootstrap for US7962495 demos."""

from __future__ import annotations

from .core_types import (
    BaseType,
    ParserSubDefinition,
    ParserType,
    PropertyComponent,
    Validator,
    ValidatorType,
)
from .ontology import DynamicOntology

US_STATES = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]


def create_sample_ontology(ontology: DynamicOntology | None = None) -> DynamicOntology:
    """Create a sample dynamic ontology with parsers and sample Person rows."""
    ontology = ontology or DynamicOntology()

    # Reset if already populated (idempotent for GUI re-runs)
    if ontology.object_types or ontology.property_types:
        ontology.object_types.clear()
        ontology.property_types.clear()
        ontology.object_instances.clear()
        ontology.mappings.clear()
        ontology._change_log.clear()

    ontology.create_object_type(
        name="Person",
        display_name="Person",
        uri="com.example.object.person",
        base_type="com.example.object.entity",
        icon="person",
        description="A person or individual",
    )
    ontology.create_object_type(
        name="Organization",
        display_name="Organization",
        uri="com.example.object.organization",
        base_type="com.example.object.entity",
        icon="org",
        description="An organization or company",
    )

    ontology.create_property_type(
        name="Name",
        display_name="Name",
        base_type=BaseType.COMPOSITE,
        icon="name",
        description="A person's name",
        associated_words=["full name", "name"],
    )
    ontology.add_component_to_property_type(
        "Name",
        PropertyComponent(
            name="FirstName",
            base_type=BaseType.STRING,
            description="First name",
            is_required=True,
        ),
    )
    ontology.add_component_to_property_type(
        "Name",
        PropertyComponent(
            name="LastName",
            base_type=BaseType.STRING,
            description="Last name",
            is_required=True,
        ),
    )
    ontology.add_component_to_property_type(
        "Name",
        PropertyComponent(
            name="MiddleName",
            base_type=BaseType.STRING,
            description="Middle name",
            is_required=False,
            default_value="",
        ),
    )

    ontology.create_property_type(
        name="Address",
        display_name="Address",
        base_type=BaseType.COMPOSITE,
        icon="address",
        description="A physical address",
        associated_words=["address", "location"],
    )
    ontology.add_component_to_property_type(
        "Address",
        PropertyComponent(
            name="Street1",
            base_type=BaseType.STRING,
            description="Street address line 1",
            is_required=True,
        ),
    )
    ontology.add_component_to_property_type(
        "Address",
        PropertyComponent(
            name="Street2",
            base_type=BaseType.STRING,
            description="Street address line 2",
            is_required=False,
            default_value="",
        ),
    )
    ontology.add_component_to_property_type(
        "Address",
        PropertyComponent(
            name="City",
            base_type=BaseType.STRING,
            description="City",
            is_required=True,
        ),
    )
    ontology.add_component_to_property_type(
        "Address",
        PropertyComponent(
            name="State",
            base_type=BaseType.STRING,
            description="State",
            is_required=True,
            validator=Validator(
                validator_type=ValidatorType.SET,
                value=US_STATES,
                error_message="Invalid state code",
            ),
        ),
    )
    ontology.add_component_to_property_type(
        "Address",
        PropertyComponent(
            name="ZIP",
            base_type=BaseType.NUMBER,
            description="ZIP code",
            is_required=True,
            validator=Validator(
                validator_type=ValidatorType.REGEX,
                value=r"^\d{5}(-\d{4})?$",
                error_message="Invalid ZIP code",
            ),
        ),
    )

    ontology.create_property_type(
        name="Phone",
        display_name="Phone",
        base_type=BaseType.STRING,
        icon="phone",
        description="Phone number",
        associated_words=["phone", "telephone", "contact"],
    )
    ontology.add_validator_to_property_type(
        "Phone",
        Validator(
            validator_type=ValidatorType.REGEX,
            value=r"^[\d\-+() ]{7,15}$",
            error_message="Invalid phone number",
        ),
    )

    ontology.create_property_type(
        name="Email",
        display_name="Email",
        base_type=BaseType.EMAIL,
        icon="email",
        description="Email address",
        associated_words=["email", "e-mail"],
    )
    ontology.add_validator_to_property_type(
        "Email",
        Validator(
            validator_type=ValidatorType.REGEX,
            value=r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$",
            error_message="Invalid email address",
        ),
    )

    ontology.create_property_type(
        name="Age",
        display_name="Age",
        base_type=BaseType.NUMBER,
        icon="number",
        description="Age in years",
        associated_words=["age", "years old"],
    )
    ontology.add_validator_to_property_type(
        "Age",
        Validator(
            validator_type=ValidatorType.RANGE,
            value=(0, 150),
            error_message="Age must be between 0 and 150",
        ),
    )

    for prop in ("Name", "Address", "Phone", "Email", "Age"):
        ontology.add_property_to_object_type("Person", prop)
    for prop in ("Name", "Address", "Phone"):
        ontology.add_property_to_object_type("Organization", prop)

    ontology.create_parser_definition(
        "Name",
        "NameParser_LastFirst",
        ParserType.REGULAR_EXPRESSION,
        r"^(\w+),\s*(\w+)$",
        sub_definitions=[
            ParserSubDefinition("1", "LastName", "Name"),
            ParserSubDefinition("2", "FirstName", "Name"),
        ],
        priority=0,
    )
    ontology.create_parser_definition(
        "Name",
        "NameParser_FirstLast",
        ParserType.REGULAR_EXPRESSION,
        r"^(\w+)\s+(\w+)$",
        sub_definitions=[
            ParserSubDefinition("1", "FirstName", "Name"),
            ParserSubDefinition("2", "LastName", "Name"),
        ],
        priority=1,
    )
    ontology.create_parser_definition(
        "Name",
        "NameParser_FirstMiddleLast",
        ParserType.REGULAR_EXPRESSION,
        r"^(\w+)\s+([\w.]+)\s+(\w+)$",
        sub_definitions=[
            ParserSubDefinition("1", "FirstName", "Name"),
            ParserSubDefinition("2", "MiddleName", "Name"),
            ParserSubDefinition("3", "LastName", "Name"),
        ],
        priority=2,
    )

    # Street1, Street2, City, ST ZIP
    ontology.create_parser_definition(
        "Address",
        "AddressParser_WithApt",
        ParserType.REGULAR_EXPRESSION,
        r"^([^,]+),\s*([^,]+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$",
        sub_definitions=[
            ParserSubDefinition("1", "Street1", "Address"),
            ParserSubDefinition("2", "Street2", "Address"),
            ParserSubDefinition("3", "City", "Address"),
            ParserSubDefinition("4", "State", "Address"),
            ParserSubDefinition("5", "ZIP", "Address"),
        ],
        priority=0,
        default_values={"Street2": ""},
    )
    # Street1, City, ST ZIP
    ontology.create_parser_definition(
        "Address",
        "AddressParser_Simple",
        ParserType.REGULAR_EXPRESSION,
        r"^([^,]+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$",
        sub_definitions=[
            ParserSubDefinition("1", "Street1", "Address"),
            ParserSubDefinition("2", "City", "Address"),
            ParserSubDefinition("3", "State", "Address"),
            ParserSubDefinition("4", "ZIP", "Address"),
        ],
        priority=1,
        default_values={"Street2": ""},
    )

    ontology.create_mapping(
        object_type="Person",
        field_mappings={
            "name": "Name",
            "address": "Address",
            "phone": "Phone",
            "email": "Email",
            "age": "Age",
        },
        row_identifier="name",
    )

    sample_data = [
        {
            "name": "Smith, John",
            "address": "123 Main St, Apt 4B, New York, NY 10001",
            "phone": "555-123-4567",
            "email": "john.smith@example.com",
            "age": 30,
        },
        {
            "name": "Jane Doe",
            "address": "456 Oak Ave, Los Angeles, CA 90210",
            "phone": "555-987-6543",
            "email": "jane.doe@example.com",
            "age": 25,
        },
        {
            "name": "Robert J. Johnson",
            "address": "789 Pine Rd, Chicago, IL 60614",
            "phone": "555-555-5555",
            "email": "robert.j@example.com",
            "age": 45,
        },
    ]
    ontology.parse_and_store_data(sample_data, "Person")
    return ontology
