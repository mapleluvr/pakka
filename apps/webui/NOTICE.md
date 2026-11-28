# Pakka WebUI Backend notices

This package provides the Pakka HTTP service, product assembly and Backend contributions. The browser application is delivered as a fixed artifact from the independent pakka-webui repository; its third-party notices and licenses are included inside `dist/frontend` with the verified application assets.

Parts of the service and workbench design descend from Tanner Middleton's pi-pocket (`TannerMidd/pi-pocket@de612d5622cdc66b6b8b4900c650c6f2efdf4c63`), with command/interface references from `mapleluvr/pi-pocket@58a4fdcc88ed755023aea9fac897735fca7396fe`. The original MIT notice is retained in `LICENSE.pi-pocket`. Historical source ancestry is recorded under `integrations/pocket/` in the Pakka repository.

Backend contributions use Pakka's public services, human identity and native Conversation records. React/Astryx UI contributions consume the shared runtime provided by the independent frontend. Node dependencies, including QRCode, retain the licenses in their installed packages.
