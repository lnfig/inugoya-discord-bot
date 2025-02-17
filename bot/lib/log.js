const fs = require('node:fs/promises');
const dayjs = require('./dayjsSetup');

/**
 * @param {unknown} value
 * @returns {string}
 */
const formatter = value => {
  /**
   * @param {unknown} value
   * @param {boolean} inner
   * @param {number} depth
   * @returns {string}
   */
  const core = (value, inner, depth) => {
    if (value == null) return 'null';

    switch (typeof value) {
      case 'string'  : return inner ? `'${value}'` : value;
      case 'number'  : return String(value);
      case 'bigint'  : return value + 'n';
      case 'boolean' : return String(value);
      case 'symbol'  : return `Symbol(${value.description ?? ''})`;
      case 'function': return `function (${value.name})`;
      default /* object */: {
        if (value instanceof Array) {
          return `[ ${value.map(x => core(x, true, depth + 1)).join(', ')} ]`;
        }
        const content = Object.entries(value).map(([key, val]) => '  '.repeat(depth) + `${key}: ${core(val, true, depth + 1)},`).join('\n');
        return `{\n${content}\n}`
      }
    }
  };
  return core(value, false, 1);
};

/**
 * @param {...unknown} values
 * @returns {Promise<void>}
 */
exports.log = (...values) => {
  const now = dayjs().tz();
  const strings = [
    now.format('YYYY/MM/DD HH:mm:ss.SSS'),
    ...values.map(formatter),
  ];

  const wp = fs.writeFile(`logs/${now.format('YYYY-MM-DD')}.log`, strings.join(' ') + '\n', { encoding: 'utf-8', flag: 'a' });
  console.log(...strings);

  return wp;
};
