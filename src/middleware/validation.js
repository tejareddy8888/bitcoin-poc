const { validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array(),
    });
  }
  next();
};

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

const successResponse = (data, message = 'Success') => ({
  success: true,
  message,
  data,
});

const errorResponse = (error, message = 'Error occurred') => ({
  success: false,
  message,
  error: error.message || error,
});

module.exports = { handleValidationErrors, asyncHandler, successResponse, errorResponse };
