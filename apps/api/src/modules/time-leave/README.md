# TimeLeave Module

**Bounded context:** time-leave

## PRD Requirements
TODO: Link to PRD sections for this module (e.g. ORG-01, PPL-01 )

## Interfaces
Modules must communicate through explicit interfaces/events  never by accessing another module's tables directly.

## Notes
- All service methods must accept and filter by \organisationId\
- Add a tenant-isolation test for every new endpoint
- Sensitive fields must be classified and encrypted/masked
