const Joi = require('joi');

// 借款接口校验规则
const borrowSchema = Joi.object({
  userId: Joi.number().integer().positive().required(),
  amount: Joi.number().integer().min(100).max(50000).required(),
  creditProof: Joi.object({
    id: Joi.string().required(),
    verificationCode: Joi.string().optional(),
    creditScore: Joi.number().integer().min(300).max(850).optional()
  }).unknown(true).required(),
  verificationCode: Joi.string().required(),
  signature: Joi.string().min(64).max(256).required(),
  term: Joi.number().integer().valid(7, 14, 30, 60, 90).optional().default(30)
});

// 还款接口校验规则
const repaySchema = Joi.object({
  userId: Joi.number().integer().positive().required(),
  transactionId: Joi.number().integer().positive().required(),
  creditProof: Joi.object({
    id: Joi.string().required()
  }).unknown(true).required(),
  verificationCode: Joi.string().required(),
  signature: Joi.string().min(64).max(256).required()
});

// 出资接口校验规则
const investSchema = Joi.object({
  userId: Joi.number().integer().positive().required(),
  amount: Joi.number().integer().min(100).max(100000).required(),
  term: Joi.number().integer().min(7).max(365).required(),
  creditProof: Joi.object({
    id: Joi.string().required()
  }).unknown(true).required(),
  verificationCode: Joi.string().required(),
  signature: Joi.string().min(64).max(256).required()
});

// 赎回接口校验规则
const redeemSchema = Joi.object({
  userId: Joi.number().integer().positive().required(),
  amount: Joi.number().integer().min(100).max(50000).required(),
  creditProof: Joi.object({
    id: Joi.string().required()
  }).unknown(true).required(),
  verificationCode: Joi.string().required(),
  signature: Joi.string().min(64).max(256).required()
});

module.exports = {
  borrowSchema,
  repaySchema,
  investSchema,
  redeemSchema
};