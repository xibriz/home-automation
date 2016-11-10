<?php
/*** ImportTelldusLive Proxy Script *******************************************

Version: 1.0.0
-----------------------------------------------------------------------------
Author: Ruben Andreassen <rubean85@gmail.com>
Description:
    Proxy Script for the ImportTelldusLive module in Z-Way
    Needs to run on on a local web-server with the z-way-service is
******************************************************************************/

require_once 'HTTP/OAuth/Consumer.php';

define('PUBLIC_KEY', '');
define('PRIVATE_KEY', '');
define('TOKEN', '');
define('TOKEN_SECRET', '');

define('URL', 'http://api.telldus.com'); //https should be used in production!
define('REQUEST_URI', constant('URL').'/json');

header('Content-Type: application/json');

if (isset($_GET['URI']) && isset($_GET['params'])) {
    
    $uri = json_decode(filter_input(INPUT_GET, 'URI'));
    $params = json_decode(filter_input(INPUT_GET, 'params'));
    foreach ($params as $key => $value) {
        $paramsArray[$key] = $value;
    }
    
    $consumer = new HTTP_OAuth_Consumer(constant('PUBLIC_KEY'), constant('PRIVATE_KEY'), constant('TOKEN'), constant('TOKEN_SECRET'));
    $response = $consumer->sendRequest(constant('REQUEST_URI').'/'.$uri->resource.'/'.$uri->function, $paramsArray, 'GET');
    echo $response->getBody();
} else {
    echo json_encode(array("error" => "GET variable URI and params are required"));
}