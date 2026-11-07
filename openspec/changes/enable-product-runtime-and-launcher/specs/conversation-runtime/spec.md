# Conversation runtime delta

## Native model access

Trusted bootstrap may supply Pi Models or a getter. Runtime uses native provider/modelId references and real catalog metadata; operational consumers receive only immutable metadata. Legacy host model fields remain an explicit compatibility path. An unselected model does not prevent storage from opening, and does not authorize inference.

## Recoverable generation failure

A failed model response remains observable as a failed native generation. It does not classify known persisted history as unknown effects. Once idle, a later explicit input or approved model change is allowed without replacing the Session. Storage and unconfirmed execution effects remain closed. Reopen never replays a completed input.

## Literal input

Text beginning with a slash is valid literal input. Only explicit registered commands enter command handlers; validation, authority, input mode and request identity remain enforced.

## Configuration and budget evolution

Additive unused profile definitions do not invalidate current profiles. Used capability changes require explicit checked migration. Budget changes preserve previous consumption and unknown reservations, and have an observable versioned record.
