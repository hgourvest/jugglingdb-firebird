var fb = require('node-firebird');

function quote(value) {
    return '"' + value + '"';
}

exports.initialize = function initializeSchema(schema, callback) {
    if (!fb) return;
    schema.adapter = new FB(schema);

    fb.attachOrCreate(schema.settings,
        function (err, client) {
            if (!err){
                schema.adapter.client = client;
                callback();
            }else{
                console.error(err);
                throw new Error(err);
            }
        }
    );
};

function FB(schema) {
    this._models = {};
    this.schema = schema;
}

FB.prototype.define = function (descr) {
    if (!descr.settings) descr.settings = {};
    this._models[descr.model.modelName] = descr;
};

FB.prototype.automigrate = function (cb) {
    var wait = 0;
    var self = this;

    this.client.startTransaction(
        function(err, tr) {
            Object.keys(self._models).forEach(
                function (name) {
                    var table = self.schema.tableName(name);
                    var model = self._models[name];
                    wait += 1;

                    var sql = 'RECREATE TABLE ' + quote(table) + '(\n'+
                        ' "id" INTEGER NOT NULL,\n';

                    Object.keys(model.properties).forEach(
                        function (field) {
                            var str;
                            if (field === 'id') return;
                            var f = model.properties[field];
                            switch (f.type.name) {
                                case 'String':
                                    str = 'Varchar(' + (f.length || 255) + ')';
                                    break;
                                case 'Number':
                                    str = 'Double precision';
                                    break;
                                case 'Date':
                                    str = 'Timestamp';
                                    break;
                                case 'Boolean':
                                    str = 'Smallint';
                                    break;
                                default:
                                    str = 'Blob sub_type 1';
                            }
                            sql += ' ' + quote(field) + ' ' + str + (f.allowNull === false || f['null'] === false ? ' NOT NULL,' : ',') + '\n';
                        }
                    );
                    sql += ' PRIMARY KEY ("id"))';

                    tr.execute(sql, function(err){
                        console.log(arguments);
                        if (!err) {
                            var sequence = quote(table + '_SEQ');
                            tr.execute('create generator ' + sequence);
                            tr.execute('set generator ' + sequence + ' to 0');
                            tr.execute(
                                'CREATE TRIGGER ' + quote(table + '_BI') + ' FOR ' + quote(table) + '\n' +
                                    'ACTIVE BEFORE INSERT POSITION 0\n'+
                                    'AS\n' +
                                    'BEGIN\n' +
                                    '  IF (NEW."id" IS NULL) THEN\n' +
                                    '    NEW."id" = GEN_ID(' + sequence +', 1);\n' +
                                    'END', done);
                        } else {
                            done(err);
                        }
                    });
                }
            );

            if (wait === 0) cb();

            function done(err) {
                if (err){
                    tr.rollback(cb);
                } else {
                    if (--wait === 0) {
                        tr.commit(cb);
                    }
                }
            }
        }
    );
};

FB.prototype.create = function (name, data, callback) {
    var table = this.schema.tableName(name);
    var sql = 'INSERT INTO ' + quote(table);

    var fields = [];
    var values = [];
    var params = [];

    Object.keys(data).forEach(
        function (key) {
            if (key === 'id') return;
            fields.push(quote(key));
            values.push('?');
            params.push(data[key]);
        }
    );

    if (fields.length) {
        sql += ' (' + fields.join(',') + ') VALUES (' + values.join(',') + ')';
    } else {
        sql += ' VALUES ()';
    }

    sql += ' RETURNING "id"';

    this.client.execute(sql, params,
        function (err, result) {
            callback(err, (result)?result[0]:undefined);
        }
    );
};

FB.prototype.destroy = function destroy(name, id, callback) {
    if (id) {
        var table = this.schema.tableName(name);
        var sql = 'DELETE FROM ' + quote(table) + ' WHERE "id" = ?';
        this.client.execute(sql, id, callback);
    } else {
        callback('nothing to destroy');
    }
};

FB.prototype.save = function (name, data, callback) {
    var table = this.schema.tableName(name);
    var sql = 'UPDATE ' + quote(table) + ' SET ';

    var fields = [];
    var params = [];
    var model = this._models[name];

    Object.keys(data).forEach(
        function (key) {
            if (key === 'id') return;
            fields.push(quote(key) + ' = ?');
            if ((data[key]) && (model.properties[key].type.name === 'Date')) {
                params.push(new Date(data[key]));
            } else {
                params.push(data[key]);
            }
        }
    );
    sql += fields.join(',') + ' WHERE "id"=?';
    params.push(data.id);

    this.client.execute(sql, params, callback);
};

FB.prototype.find = function find(name, id, callback) {
    var table = this.schema.tableName(name);
    var sql = 'SELECT FIRST 1 * FROM ' + quote(table) + ' WHERE "id" = ?';
    this.client.query(sql, id,
        function(err, result){
            callback(err, (result && result.length == 1)? result[0] : undefined);
        }
    );
};

FB.prototype.all = function(name, filter, callback) {
    var table = this.schema.tableName(name);
    var sql = '* FROM ' + quote(table);
    var params = [];

    if (filter) {
        var self = this;
        if (filter.where) {
            sql += ' ' + buildWhere(filter.where);
        }

        if (filter.order) {
            sql += ' ' + buildOrderBy(filter.order);
        }

        if (filter.limit) {
            sql = buildLimit(filter.limit, filter.offset || 0) + ' ' + sql;
        }

    }
    this.client.query('SELECT ' + sql, params, callback);

    function buildWhere(conds) {
        var cs = [];
        var props = self._models[name].properties;
        Object.keys(conds).forEach(
            function (key) {
                var keyEscaped = quote(key);
                var val = conds[key];
                var lst, i;
                if (conds[key] === null) {
                    cs.push(keyEscaped + ' IS NULL');
                } else if (conds[key].constructor.name === 'Object') {
                    switch (Object.keys(conds[key])[0]) {
                        case 'gt':
                            cs.push(keyEscaped + ' > ?');
                            params.push(val.gt);
                            break;
                        case 'gte':
                            cs.push(keyEscaped + ' >= ?');
                            params.push(val.gte);
                            break;
                        case 'lt':
                            cs.push(keyEscaped + ' < ?');
                            params.push(val.lt);
                            break;
                        case 'lte':
                            cs.push(keyEscaped + ' <= ?');
                            params.push(val.lte);
                            break;
                        case 'between':
                            cs.push(keyEscaped + ' BETWEEN ? AND ?');
                            params.push(val.between[0]);
                            params.push(val.between[1]);
                            break;
                        case 'inq':
                            if (val.inq instanceof Array) {
                                lst = new Array(val.inq.length);
                                for (i = 0; i < val.inq.length; i++){
                                    lst[i] = '?';
                                    params.push(val.inq[i]);
                                }
                            } else {
                                lst = [val.inq];
                                params.push(val.inq);
                            }
                            cs.push(keyEscaped + ' IN (' + lst.join(',') + ')');
                            break;
                        case 'nin':
                            if (val.nin instanceof Array) {
                                lst = new Array(val.nin.length);
                                for (i = 0; i < val.nin.length; i++){
                                    lst[i] = '?';
                                    params.push(val.nin[i]);
                                }
                            } else {
                                lst = [val.nin];
                                params.push(val.nin);
                            }
                            cs.push(keyEscaped + ' NOT IN (' + lst.join(',') + ')');
                            break;
                        case 'neq':
                            cs.push(keyEscaped + ' != ?');
                            params.push(val.neq);
                            break;
                    }
                } else {
                    cs.push(keyEscaped + ' = ?');
                    params.push(val);
                }
            }
        );
        if (cs.length === 0) {
            return '';
        }
        return 'WHERE ' + cs.join(' AND ');
    }

    function buildOrderBy(order) {
        if (typeof order === 'string') {
            order = order.split(' ');
            order[0] = [quote(order[0])];
            return 'ORDER BY ' + order.join(' ');
        } else {
            for (var i = 0; i < order.length; i++) {
                order[i] = quote(order[i]);
            }
            return 'ORDER BY ' + order.join(', ');
        }
    }

    function buildLimit(limit, offset) {
        var ret = 'FIRST ' + limit;
        if (offset) {
            ret += ' SKIP ' + offset;
        }
        return ret;
    }
};

FB.prototype.destroyAll = function(name, callback){
    var table = this.schema.tableName(name);
    var sql = 'DELETE FROM ' + quote(table);
    this.client.query(sql, callback);
};

FB.prototype.count = function count(name, callback, where) {
    var table = this.schema.tableName(name);
    var params = [];
    var model = this._models[name];

    this.client.execute('SELECT count(*) FROM ' + quote(table) + buildWhere(where), params,
        function (err, result) {
            callback(err, (result)?result[0][0]:undefined);
        }
    );

    function buildWhere(conds) {
        var cs = [];
        Object.keys(conds || {}).forEach(
            function (key) {
                if (conds[key] === null) {
                    cs.push(quote(key) + ' IS NULL');
                } else {
                    cs.push(quote(key) + ' = ?');
                    if (model.properties[key].type.name === 'Date') {
                        params.push(new Date(conds[key]));
                    } else {
                        params.push(conds[key]);
                    }
                }
            }
        );
        return cs.length ? ' WHERE ' + cs.join(' AND ') : '';
    }
};

FB.prototype.exists = function count(name, id, callback) {
    var table = this.schema.tableName(name);
    var sql = 'SELECT FIRST 1 "id" FROM ' + quote(table) + ' WHERE "id" = ?';
    this.client.execute(sql, id,
        function(err, data){
            callback(err, (data)?data.length === 1:undefined)
        }
    );
};

FB.prototype.updateAttributes = function updateAttrs(model, id, data, cb) {
    data.id = id;
    this.save(model, data, cb);
};

FB.prototype.updateOrCreate = function (name, data, callback) {
    var table = this.schema.tableName(name);
    var sql = 'UPDATE OR INSERT INTO ' + quote(table);

    var fields = [];
    var values = [];
    var params = [];

    Object.keys(data).forEach(
        function (key) {
            fields.push(quote(key));
            values.push('?');
            params.push(data[key]);
        }
    );

    if (fields.length) {
        sql += ' (' + fields.join(',') + ') VALUES (' + values.join(',') + ')';
    } else {
        sql += ' VALUES ()';
    }

    this.client.execute(sql, params,
        function (err) {
            callback(err, data);
        }
    );
};
