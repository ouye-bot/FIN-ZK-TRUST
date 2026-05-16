const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema({
  borrower: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  interestRate: {
    type: Number,
    required: true
  },
  startTime: {
    type: Date,
    required: true
  },
  duration: {
    type: Number, // in days
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isRepaid: {
    type: Boolean,
    default: false
  }
});

module.exports = mongoose.model('Loan', loanSchema); 