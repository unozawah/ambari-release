/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Application bootstrapper

var stringUtils = require('utils/string_utils');

module.exports = Em.Application.create({
  name: 'Ambari Web',
  rootElement: '#wrapper',

  store: DS.Store.create({
    revision: 4,
    adapter: DS.FixtureAdapter.create({
      simulateRemoteResponse: false
    })
  }),
  isAdmin: false,
  /**
   * return url prefix with number value of version of HDP stack
   */
  stackVersionURL:function(){
    var stackVersion = this.get('currentStackVersion') || this.get('defaultStackVersion');
    if(stackVersion.indexOf('HDPLocal') !== -1){
      return '/stacks/HDPLocal/version/' + stackVersion.replace(/HDPLocal-/g, '');
    }
    return '/stacks/HDP/version/' + stackVersion.replace(/HDP-/g, '');
  }.property('currentStackVersion'),
  
  /**
   * return url prefix with number value of version of HDP stack
   */
  stack2VersionURL:function(){
    var stackVersion = this.get('currentStackVersion') || this.get('defaultStackVersion');
    if(stackVersion.indexOf('HDPLocal') !== -1){
      return '/stacks2/HDPLocal/versions/' + stackVersion.replace(/HDPLocal-/g, '');
    }
    return '/stacks2/HDP/versions/' + stackVersion.replace(/HDP-/g, '');
  }.property('currentStackVersion'),
  clusterName: null,
  currentStackVersion: '',
  currentStackVersionNumber: function(){
    return this.get('currentStackVersion').replace(/HDP(Local)?-/, '');
  }.property('currentStackVersion'),
  isHadoop2Stack: function(){
    return (stringUtils.compareVersions(this.get('currentStackVersionNumber'), "2.0") === 1 ||
      stringUtils.compareVersions(this.get('currentStackVersionNumber'), "2.0") === 0)
  }.property('currentStackVersionNumber'),

  /**
   * If High Availability is enabled
   * Based on <code>clusterStatus.isInstalled</code>, stack version, <code>SNameNode</code> availability
   *
   * @type {Boolean}
   */
  isHaEnabled: function() {
    if (!this.get('isHadoop2Stack')) return false;
    return !this.HostComponent.find().someProperty('componentName', 'SECONDARY_NAMENODE');
  }.property('router.clusterController.isLoaded'),

  /**
   * List of disabled components for the current stack with related info.
   * Each element has followed structure:
   * @type {Em.Object}
   *   @property componentName {String} - name of the component
   *   @property properties {Object} - mapped properties by site files,
   *    for example:
   *      properties: { global_properties: [], site_properties: [], etc. }
   *   @property reviewConfigs {Ember.Object} - reference review_configs.js
   *   @property serviceComponent {Object} - reference service_components.js
   *
   * @type {Array}
   */
  stackDependedComponents: [],

  /**
   * Restore component data that was excluded from stack.
   *
   * @param component {Ember.Object} - #stackDependedComponents item
   */
  enableComponent: function(component) {
    var propertyFileNames = ['global_properties', 'site_properties'];
    var requirePrefix = this.get('isHadoop2Stack') ? 'data/HDP2/' : 'data/';
    // add component to service_components list
    require('data/service_components').push(component.get('serviceComponent'));
    // add properties
    propertyFileNames.forEach(function(fileName) {
      require(requirePrefix + fileName).configProperties = require(requirePrefix + fileName).configProperties.concat(component.get('properties.'+fileName));
    });
    var reviewConfigsService = require('data/review_configs')
      .findProperty('config_name', 'services').config_value
      .findProperty('service_name', component.get('serviceComponent.service_name'));
    reviewConfigsService.get('service_components').pushObject(component.get('reviewConfigs'));
  },
  /**
   * Disabling component. Remove related data from lists such as
   * properties, review configs, service components.
   *
   * @param component {Object} - component info reference service_components.js
   *
   * @return {Ember.Object} - item of <code>stackDependedComponents</code> property
   */
  disableComponent: function(component) {
    var componentCopy, propertyFileNames;
    propertyFileNames = ['global_properties', 'site_properties'];
    componentCopy = Em.Object.create({
      componentName: component.component_name,
      properties: {},
      reviewConfigs: {},
      configCategory: {},
      serviceComponent: {}
    });
    componentCopy.set('serviceComponent', require('data/service_components').findProperty('component_name', component.component_name));
    // remove component from service_components list
    require('data/service_components').removeObject(componentCopy.get('serviceComponent'));
    var serviceConfigsCategoryName, requirePrefix, serviceConfig;
    // get service category name related to component
    serviceConfig = require('data/service_configs').findProperty('serviceName', component.service_name);
    serviceConfig.configCategories = serviceConfig.configCategories.filter(function(configCategory) {
      if (configCategory.get('hostComponentNames')) {
        serviceConfigsCategoryName = configCategory.get('name');
        if (configCategory.get('hostComponentNames').contains(component.component_name)) {
          componentCopy.set('configCategory', configCategory);
        }
      }
      return true;
    });
    requirePrefix = this.get('isHadoop2Stack') ? 'data/HDP2/' : 'data/';
    var propertyObj = {};
    propertyFileNames.forEach(function(propertyFileName) {
      propertyObj[propertyFileName] = [];
    });
    // remove config properties related to this component
    propertyFileNames.forEach(function(propertyFileName) {
      var properties = require(requirePrefix + propertyFileName);
      properties.configProperties = properties.configProperties.filter(function(property) {
        if (property.category == serviceConfigsCategoryName) {
          propertyObj[propertyFileName].push(property);
          return false;
        } else {
          return true;
        }
      });
    });
    componentCopy.set('properties', propertyObj);
    // remove component from review configs
    var reviewConfigsService = require('data/review_configs')
      .findProperty('config_name', 'services').config_value
      .findProperty('service_name', component.service_name);
    reviewConfigsService.set('service_components', reviewConfigsService.get('service_components').filter(function (serviceComponent) {
      if (serviceComponent.get('component_name') != component.component_name) {
        return true;
      } else {
        componentCopy.set('reviewConfigs', serviceComponent);
        return false;
      }
    }));
    return componentCopy;
  },
  /**
   * Resolve dependency in components. Check forbidden/allowed components and
   * remove/restore related data.
   */
  handleStackDependedComponents: function() {
    // need for unit testing
    if (this.get('handleStackDependencyTest')) return;
    var stackVersion, stackDependedComponents;
    stackVersion = this.get('currentStackVersionNumber');
    stackDependedComponents = [];
    // disable components
    require('data/service_components').filterProperty('stackVersions').forEach(function(component) {
      if (!component.stackVersions.contains(stackVersion))
        stackDependedComponents.push(this.disableComponent(component));
    }, this);
    // enable components
    if (this.get('stackDependedComponents').length > 0) {
      this.get('stackDependedComponents').forEach(function(component) {
        if (component.get('serviceComponent').stackVersions.contains(this.get('currentStackVersionNumber'))) {
          this.enableComponent(component);
          stackDependedComponents = this.get('stackDependedComponents').removeObject(component);
        }
      }, this);
    }
    this.set('stackDependedComponents', this.get('stackDependedComponents').concat(stackDependedComponents));
  }.observes('currentStackVersionNumber'),

  /**
   * List of components with allowed action for them
   * @type {Em.Object}
   */
  components: Ember.Object.create({
    reassignable: ['NAMENODE', 'SECONDARY_NAMENODE', 'JOBTRACKER', 'RESOURCEMANAGER'],
    restartable: ['APP_TIMELINE_SERVER'],
    deletable: ['SUPERVISOR', 'HBASE_MASTER', 'DATANODE', 'TASKTRACKER', 'NODEMANAGER', 'HBASE_REGIONSERVER'],
    rollinRestartAllowed: ["DATANODE", "TASKTRACKER", "NODEMANAGER", "HBASE_REGIONSERVER", "SUPERVISOR"],
    decommissionAllowed: ["DATANODE", "TASKTRACKER", "NODEMANAGER", "HBASE_REGIONSERVER"],
    addableToHost: ["DATANODE", "TASKTRACKER", "NODEMANAGER", "HBASE_REGIONSERVER", "HBASE_MASTER", "ZOOKEEPER_SERVER", "SUPERVISOR"],
    slaves: function() {
      return require('data/service_components').filter(function(component){
        return !component.isClient && !component.isMaster
      }).mapProperty('component_name').uniq().without("DASHBOARD");
    }.property().cacheable(),

    masters: function() {
      return require('data/service_components').filterProperty('isMaster', true).mapProperty('component_name').uniq();
    }.property().cacheable(),
    clients: function() {
      return require('data/service_components').filterProperty('isClient', true).mapProperty('component_name').uniq();
    }.property().cacheable()
  })
});

/**
 * overwritten set method of Ember.View to avoid uncaught errors
 * when trying to set property of destroyed view
 */
Em.View.reopen({
  set: function(attr, value){
    if(!this.get('isDestroyed') && !this.get('isDestroying')){
      this._super(attr, value);
    } else {
      console.debug('Calling set on destroyed view');
    }
  }
});

/**
 * Ambari overrides the default date transformer.
 * This is done because of the non-standard data
 * sent. For example Nagios sends date as "12345678".
 * The problem is that it is a String and is represented
 * only in seconds whereas Javascript's Date needs
 * milliseconds representation.
 */
DS.attr.transforms.date = {
  from: function (serialized) {
    var type = typeof serialized;
    if (type === "string") {
      serialized = parseInt(serialized);
      type = typeof serialized;
    }
    if (type === "number") {
      // The number could be seconds or milliseconds.
      // If seconds, then multiplying with 1000 should still
      // keep it below the current time.
      if (serialized * 1000 < new Date().getTime()) {
        serialized = serialized * 1000;
      }
      return new Date(serialized);
    } else if (serialized === null || serialized === undefined) {
      // if the value is not present in the data,
      // return undefined, not null.
      return serialized;
    } else {
      return null;
    }
  },
  to: function (deserialized) {
    if (deserialized instanceof Date) {
      return deserialized.getTime();
    } else if (deserialized === undefined) {
      return undefined;
    } else {
      return null;
    }
  }
};

DS.attr.transforms.object = {
  from: function(serialized) {
    return Ember.none(serialized) ? null : Object(serialized);
  },

  to: function(deserialized) {
    return Ember.none(deserialized) ? null : Object(deserialized);
  }
};

/**
 * Allows EmberData models to have array properties.
 *
 * Declare the property as <code>
 *  operations: DS.attr('array'),
 * </code> and
 * during load provide a JSON array for value.
 *
 * This transform simply assigns the same array in both directions.
 */
DS.attr.transforms.array = {
  from : function(serialized) {
    return serialized;
  },
  to : function(deserialized) {
    return deserialized;
  }
};
