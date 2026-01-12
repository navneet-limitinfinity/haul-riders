# Figma-based frontend preview

This folder contains a copy of the Figma UI (desktop-first) for review and iteration.

Run:

  cd web
  npm i
  npm run dev

Run tests / snapshots and linting:

  cd web
  npm i
  npm test            # run tests
  npm test -- --updateSnapshot   # update snapshots after changes
  npm run lint        # run linter
  npm run lint:fix    # try to auto-fix lint problems

The original Figma source folder (`Courier Dashboard with Order Management Figma code/`) is not committed and used only as source.
