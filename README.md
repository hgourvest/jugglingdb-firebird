# jugglingdb-firebird

Firebird database adapter for JugglingDB

## Install

	npm install jugglingdb jugglingdb-firebird

## Usage

```javascript
var Schema = require('jugglingdb').Schema;
var schema = new Schema('firebird', {database: "/path/to/database.fdb"});


To use it you need `jugglingdb@0.2.x`.

1. Setup dependencies in `package.json`:

    ```json
    {
      ...
      "dependencies": {
        "jugglingdb": "0.2.x",
        "jugglingdb-mysql": "latest"
      },
      ...
    }
    ```

2. Use:

    ```javascript
        var Schema = require('jugglingbd').Schema;
        var schema = new Schema('mysql', {
            database: '/path/to/database.fdb'
        });
    ```
