// Validação de CPF/CNPJ no navegador (espelha o servidor em /validators.js).
(function () {
  const onlyDigits = (v) => String(v || "").replace(/\D/g, "");

  function isValidCPF(value) {
    const cpf = onlyDigits(value);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;
    const calc = (len) => {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
      const r = (sum * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
  }

  function isValidCNPJ(value) {
    const cnpj = onlyDigits(value);
    if (cnpj.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(cnpj)) return false;
    const calc = (len) => {
      const weights = len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let sum = 0;
      for (let i = 0; i < len; i++) sum += Number(cnpj[i]) * weights[i];
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13]);
  }

  function validateDocument(value) {
    const digits = onlyDigits(value);
    if (digits.length === 11) return { valid: isValidCPF(digits), type: "cpf", normalized: digits };
    if (digits.length === 14) return { valid: isValidCNPJ(digits), type: "cnpj", normalized: digits };
    return { valid: false, type: null, normalized: digits };
  }

  function formatDocument(value) {
    const d = onlyDigits(value);
    if (d.length <= 11) {
      return d
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
    }
    return d
      .replace(/(\d{2})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1/$2")
      .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
  }

  window.DocUtils = { isValidCPF, isValidCNPJ, validateDocument, formatDocument };
})();
