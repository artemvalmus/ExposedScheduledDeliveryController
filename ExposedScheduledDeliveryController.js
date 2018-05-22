let ScheduledDeliveriesRepostiroy = require('../carrier-deliveries/repository/scheduleDeliveriesRepository');
let Responses = require('../../services/Response');
let EventHistoryService = require('../../services/EventHistoryService');
let DriverDeliveryRepository = require('../carrier-deliveries/repository/driverDeliveryRepository');
let accountRepository = require("../user/repository/account");
let statusHelper = require('../scheduled/statusHelper');
let moment = require('moment');
let PostalCodeRepository = require('../postal-codes/repository');
let fleetSchema = require("../user/repository/models/fleet");
let GeoCoder = require('../../services/GeoCoder');
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ExposedScheduledDeliveryController = {
    getDelivery: (req, res, next) => {
        let deliveryId = ensureObjectId(req.params.id || '');
        let delivery;
        ScheduledDeliveriesRepostiroy.scheduled.findOne(deliveryId)
            .then(data => {
                if (!data) {
                    Responses.noData(res, "Delivery not found", {});
                    throw new Error("Delivery not found");
                }
                delivery = data;
                return EventHistoryService.getEventsForScheduledDelivery(delivery._id);
            })
            .then((events) => {
                delivery.events = events.map(event => {
                    return {
                        event: event.event,
                        event_data: event.event_data,
                        event_description: statusHelper.getDescription(event.event_data),
                        created_at: event.created_at,
                    };
                });
                return accountRepository.getById(delivery.creator);
            })
            .then((client) => {
                if (client) {
                    delivery.client = client;
                }

                return PostalCodeRepository.getForZipCode(delivery.deliveryzip)
            })
            .then((postalObject) => {
                if (postalObject) {
                    delivery.area = postalObject.AREA;
                    delivery.zone = postalObject.ZONE;
                }

                return DriverDeliveryRepository.findOne({delivery_id: deliveryId.toString()});
            })
            .then((driver_delivery) => {
                if (driver_delivery) {
                    return accountRepository.getById(ensureObjectId(driver_delivery.carrier_id))
                }
                return null;
            })
            .then((driver) => {
                if (driver && parseInt(driver.carrier) === 1) {
                    delivery.carrier = {
                        name: driver.name,
                        phone: driver.phone
                    };

                    return fleetSchema.findOne({'userID': driver._id});
                }
            })
            .then((truck) => {
                if (truck) {
                    delivery.truck = truck;
                }
                Responses.success(res, "Delivery found", delivery);
            })
            .catch((err) => {
                // console.log(err);
            })
    },
    changeDeliveryAddress: (req, res, next) => {
        let deliveryId = ensureObjectId(req.params.id || '');
        let query = {
            deliveryaddress: req.body.route + " " + req.body.street_number,
            deliveryzip: req.body.zip,
            deliverycity: req.body.city,
        };
        let newEventMessage = "Delivery Address was changed to " + query.deliveryaddress + " " + query.deliveryzip + " " + query.deliverycity;
        GeoCoder.codeAddress(
            query.deliveryaddress,
            query.deliveryzip
        ).then(coordinates => {
            if (!coordinates) {
                Responses.noData(res, "Incorrect address", {});
                throw new Error("Incorrect address");
            }

            query.deliverycoordinates = [
                parseFloat(coordinates.longitude),
                parseFloat(coordinates.latitude)
            ];
            return ScheduledDeliveriesRepostiroy.scheduled.findOneAndUpdate(deliveryId, query);
        })
            .then(data => {
                if (!data) {
                    Responses.noData(res, "Delivery not found", {});
                    throw new Error("Delivery not found");
                }
                return EventHistoryService.addCustomEvent(deliveryId, newEventMessage);
            })
            .then(event => {
                if (event) {
                    event = {
                        event: event.event,
                        event_data: event.event_data,
                        event_description: statusHelper.getDescription(event.event_data),
                        created_at: event.created_at,
                    };
                }
                Responses.success(res, "Delivery found", {success: true, data: query, event: event});
            });
    },
    changeDeliveryDateTime(req, res, next) {
        let deliveryId = ensureObjectId(req.params.id || '');
        let query = Object.assign({}, req.body);
        let newEventMessage = "Delivery Date was changed";
        if (query.deliverydate) {
            let deliveryDate = new Date(query.deliverydate);

            if (!deliveryDate.isValid()){
                Responses.noData(res, "Invalid Date", {});
                throw new Error("Invalid Date");
            }

            query.weekNumber = deliveryDate.getISOWeek().toString();
            query.deliverydayofweek = days[deliveryDate.getUTCDay()];
            query.deliverydate = deliveryDate;
            newEventMessage += " to " + moment(query.deliverydate).format("DD-MM-YYYY");
        }

        newEventMessage += ". From " + query.deliverywindowstart + " to " + query.deliverywindowend;

        ScheduledDeliveriesRepostiroy.scheduled.findOneAndUpdate(deliveryId, query)
            .then(data => {
                if (!data) {
                    Responses.noData(res, "Delivery not found", {});
                    throw new Error("Delivery not found");
                }
                return EventHistoryService.addCustomEvent(deliveryId, newEventMessage);
            })
            .then(event => {
                Responses.success(res, "Delivery found", {success: true, data: query});
            });
    }
};

module.exports = ExposedScheduledDeliveryController;